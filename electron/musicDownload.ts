import { ipcMain, type BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { getAppTempDir, getDialogDefaultDir } from './appPaths'

export interface MusicSource {
  id: string
  name: string
}

export interface MusicSong {
  song_name: string
  singers?: string | string[]
  singersText?: string
  album?: string
  source?: string
  sourceLabel?: string
  file_size?: string
  duration?: string
  ext?: string
  cover?: string
  identifier?: string
  [key: string]: unknown
}

type JsonLine =
  | { type: 'progress'; message: string; current: number; total: number }
  | { success: true; [key: string]: unknown }
  | { success: false; error?: string; [key: string]: unknown }

const DEFAULT_SOURCES: MusicSource[] = [
  { id: 'AppleMusicClient', name: '苹果音乐' },
  { id: 'DeezerMusicClient', name: 'Deezer' },
  { id: 'FiveSingMusicClient', name: '5sing' },
  { id: 'JamendoMusicClient', name: 'Jamendo' },
  { id: 'JooxMusicClient', name: 'Joox' },
  { id: 'KuwoMusicClient', name: '酷我音乐' },
  { id: 'KugouMusicClient', name: '酷狗音乐' },
  { id: 'MiguMusicClient', name: '咪咕音乐' },
  { id: 'NeteaseMusicClient', name: '网易云音乐' },
  { id: 'QQMusicClient', name: 'QQ音乐' },
  { id: 'QianqianMusicClient', name: '千千音乐' },
  { id: 'QobuzMusicClient', name: 'Qobuz' },
  { id: 'SoundCloudMusicClient', name: 'SoundCloud' },
  { id: 'StreetVoiceMusicClient', name: 'StreetVoice' },
  { id: 'SodaMusicClient', name: '汽水音乐' },
  { id: 'SpotifyMusicClient', name: 'Spotify' },
  { id: 'TIDALMusicClient', name: 'TIDAL' }
]

let mainWindow: BrowserWindow | null = null
let activeProc: ChildProcessWithoutNullStreams | null = null

function scriptsDir(): string {
  if (process.env.NODE_ENV === 'development') {
    return join(process.cwd(), 'python-scripts')
  }
  return join(process.resourcesPath, 'python-scripts')
}

function pythonCmd(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

function scriptPath(): string {
  return join(scriptsDir(), 'musicdownload.py')
}

function workDir(): string {
  return join(getAppTempDir(), 'musicdl')
}

function killActive(): boolean {
  if (!activeProc) return false
  try {
    activeProc.kill()
  } catch {
    // ignore
  }
  activeProc = null
  return true
}

function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function runMusicCmd(payload: Record<string, unknown>, onProgress?: (line: Extract<JsonLine, { type: 'progress' }>) => void): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    killActive()
    const proc = spawn(pythonCmd(), [scriptPath()], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true
    })
    activeProc = proc

    let buffer = ''
    let result: Record<string, unknown> | null = null
    let settled = false

    const finish = (res: Record<string, unknown>) => {
      if (settled) return
      settled = true
      if (activeProc === proc) activeProc = null
      resolve(res)
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as JsonLine
          if ('type' in parsed && parsed.type === 'progress') {
            onProgress?.({
              type: 'progress',
              message: String((parsed as { message?: string }).message || ''),
              current: Number((parsed as { current?: number }).current) || 0,
              total: Number((parsed as { total?: number }).total) || 0
            })
            continue
          }
          if ('success' in parsed) {
            result = parsed as Record<string, unknown>
          }
        } catch {
          // musicdl 偶发非 JSON 行，忽略
        }
      }
    })

    proc.stderr.on('data', () => {
      // 依赖库日志走 stderr，结果以 stdout JSON 为准
    })

    proc.on('error', (err) => {
      finish({
        success: false,
        error: err.message.includes('ENOENT')
          ? '未找到 python，请安装 Python 3 并加入 PATH 后重启应用'
          : err.message
      })
    })

    proc.on('close', (code, signal) => {
      if (signal) {
        finish({ success: false, error: '已取消' })
        return
      }
      if (result) {
        finish(result)
        return
      }
      finish({
        success: false,
        error: `音乐下载脚本异常退出（code ${code}）`
      })
    })

    proc.stdin.on('error', () => {
      // 进程已退出时写 stdin 会触发，忽略
    })
    proc.stdin.end(JSON.stringify(payload), 'utf8')
  })
}

export function bindMusicDownloadWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function registerMusicDownloadIpc(): void {
  ipcMain.handle('music:probe', async () => {
    const res = await runMusicCmd({ cmd: 'probe' })
    if (res.success === false) {
      return cloneForIpc({
        success: true,
        musicdlOk: false,
        error: String(res.error || '探测失败'),
        sources: DEFAULT_SOURCES,
        defaultOutputDir: getDialogDefaultDir() || ''
      })
    }
    return cloneForIpc({
      success: true,
      musicdlOk: res.musicdlOk === true,
      version: String(res.version || ''),
      error: String(res.error || ''),
      sources: Array.isArray(res.sources) ? res.sources : DEFAULT_SOURCES,
      defaultOutputDir: getDialogDefaultDir() || ''
    })
  })

  ipcMain.handle('music:search', async (_event, payload: {
    keyword?: string
    sources?: string[]
    limit?: number
    mode?: 'song' | 'playlist'
    cookie?: string
  }) => {
    const keyword = String(payload?.keyword || '').trim()
    const sources = Array.isArray(payload?.sources) ? payload.sources.map(String).filter(Boolean) : []
    if (!keyword) return { success: false, error: '请输入搜索关键词或歌单链接' }
    if (sources.length === 0) return { success: false, error: '请至少选择一个音乐来源' }
    const res = await runMusicCmd({
      cmd: 'search',
      keyword,
      sources,
      limit: payload?.limit,
      mode: payload?.mode === 'playlist' ? 'playlist' : 'song',
      cookie: String(payload?.cookie || ''),
      workDir: workDir()
    })
    if (res.success === false) {
      return { success: false, error: String(res.error || '搜索失败') }
    }
    return cloneForIpc({
      success: true,
      count: Number(res.count) || 0,
      songs: Array.isArray(res.songs) ? res.songs : []
    })
  })

  ipcMain.handle('music:download', async (_event, payload: {
    songs?: MusicSong[]
    outputDir?: string
    sources?: string[]
    limit?: number
    cookie?: string
  }) => {
    const songs = Array.isArray(payload?.songs) ? payload.songs : []
    const outputDir = String(payload?.outputDir || '').trim()
    if (songs.length === 0) return { success: false, error: '请先选择要下载的歌曲' }
    if (!outputDir) return { success: false, error: '请选择保存目录' }
    const res = await runMusicCmd(
      {
        cmd: 'download',
        songs,
        outputDir,
        sources: Array.isArray(payload?.sources) ? payload.sources : [],
        limit: payload?.limit,
        cookie: String(payload?.cookie || ''),
        workDir: join(workDir(), `job-${Date.now()}`)
      },
      (progress) => {
        mainWindow?.webContents.send('music:progress', progress)
      }
    )
    if (res.success === false) {
      return { success: false, error: String(res.error || '下载失败') }
    }
    return cloneForIpc({
      success: true,
      count: Number(res.count) || 0,
      files: Array.isArray(res.files) ? res.files : [],
      errors: Array.isArray(res.errors) ? res.errors : [],
      outputDir: String(res.outputDir || outputDir)
    })
  })

  ipcMain.handle('music:cancel', () => {
    if (killActive()) return { success: true as const }
    return { success: false as const, error: '没有正在运行的任务' }
  })
}
