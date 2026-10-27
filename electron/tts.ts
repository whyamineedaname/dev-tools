import { app, ipcMain, type WebContents } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile, rm, rename, unlink, stat } from 'fs/promises'
import { extname, isAbsolute, join, sep } from 'path'
import { getAppTempDir, getDialogDefaultDir } from './appPaths'

export interface TtsVoice {
  id: string
  name: string
  transcript: string
  note: string
  durationMs: number
  createdAt: number
  updatedAt: number
  missingFile?: boolean
}

interface IndexFile {
  version: number
  voices: TtsVoice[]
}

interface UiFile {
  lastOutputDir?: string
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const WIN_BAD_CHARS = /[\\/:*?"<>|]/
const AUDIO_EXTS = new Set(['wav', 'mp3', 'm4a', 'flac'])

let child: ChildProcessWithoutNullStreams | null = null
let stdoutBuf = ''
const pending = new Map<string, Pending>()
let intentionalKill = false
let crashCount = 0
let lastCrashAt = 0
let mutex: Promise<unknown> = Promise.resolve()
let progressTarget: WebContents | null = null

function scriptsDir(): string {
  if (process.env.NODE_ENV === 'development') {
    return join(process.cwd(), 'python-scripts')
  }
  return join(process.resourcesPath, 'python-scripts')
}

/** Prefer CosyVoice venv Python so deps live with the cloned repo. */
function pythonCmd(): string {
  const home = (process.env.COSYVOICE_HOME || '').trim()
  const candidates: string[] = []
  if (home) {
    candidates.push(
      process.platform === 'win32'
        ? join(home, '.venv', 'Scripts', 'python.exe')
        : join(home, '.venv', 'bin', 'python')
    )
  }
  // Dev convenience: CosyVoice cloned next to the app repo
  if (process.env.NODE_ENV === 'development') {
    const local = join(process.cwd(), 'CosyVoice')
    candidates.push(
      process.platform === 'win32'
        ? join(local, '.venv', 'Scripts', 'python.exe')
        : join(local, '.venv', 'bin', 'python')
    )
  }
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

function cosyvoiceHome(): string {
  const env = (process.env.COSYVOICE_HOME || '').trim()
  if (env) return env
  if (process.env.NODE_ENV === 'development') {
    const local = join(process.cwd(), 'CosyVoice')
    if (existsSync(join(local, 'cosyvoice'))) return local
  }
  return ''
}

function voicesRoot(): string {
  return join(app.getPath('userData'), 'tts-voices')
}

function indexPath(): string {
  return join(voicesRoot(), 'index.json')
}

function uiPath(): string {
  return join(voicesRoot(), 'ui.json')
}

function modelsDir(): string {
  return join(voicesRoot(), 'models')
}

function itemDir(id: string): string {
  return join(voicesRoot(), 'items', id)
}

function refWav(id: string): string {
  return join(itemDir(id), 'ref.wav')
}

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn)
  mutex = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function pythonMissingHint(): string {
  return process.platform === 'win32'
    ? '未找到 python，请安装 Python 3.10 或 3.11 并加入 PATH 后重启应用'
    : '未找到 python3，请安装 Python 3.10 或 3.11 后重启应用'
}

function spawnCapture(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    proc.on('error', (err) => resolve({ code: 1, stdout: '', stderr: '', error: err.message }))
  })
}

async function checkPythonVersion(): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await spawnCapture(pythonCmd(), ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'])
  if (result.error?.includes('ENOENT') || (result.code !== 0 && !result.stdout.trim())) {
    return { ok: false, error: pythonMissingHint() }
  }
  const ver = result.stdout.trim()
  if (ver !== '3.10' && ver !== '3.11') {
    return {
      ok: false,
      error: `需要 Python 3.10 或 3.11，当前为 ${ver || '未知'}。请安装对应版本后重试。`
    }
  }
  return { ok: true }
}

async function ffmpegAvailable(): Promise<boolean> {
  const result = await spawnCapture('ffmpeg', ['-version'])
  return result.code === 0
}

function sendProgress(payload: { phase: string; percent?: number; message?: string }): void {
  if (progressTarget && !progressTarget.isDestroyed()) {
    progressTarget.send('tts:progress', payload)
  }
}

function rejectAll(message: string): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error(message))
    pending.delete(id)
  }
}

function handleStdoutLine(line: string): void {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  if (obj.progress === true) {
    sendProgress({
      phase: typeof obj.phase === 'string' ? obj.phase : 'download',
      percent: typeof obj.percent === 'number' ? obj.percent : undefined,
      message: typeof obj.message === 'string' ? obj.message : undefined
    })
    return
  }
  const id = typeof obj.id === 'string' ? obj.id : ''
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  p.resolve(obj)
}

function onChildExit(): void {
  child = null
  stdoutBuf = ''
  if (intentionalKill) {
    intentionalKill = false
    rejectAll('已取消')
    return
  }
  const now = Date.now()
  if (now - lastCrashAt > 60_000) crashCount = 0
  lastCrashAt = now
  crashCount += 1
  rejectAll(crashCount >= 2 ? '语音引擎已停止，请重新打开本工具' : '语音引擎异常退出')
}

async function ensureWorker(): Promise<void> {
  if (child && !child.killed) return
  const py = await checkPythonVersion()
  if (!py.ok) throw new Error(py.error)
  await mkdir(modelsDir(), { recursive: true })
  const script = join(scriptsDir(), 'tts_worker.py')
  intentionalKill = false
  const home = cosyvoiceHome()
  child = spawn(pythonCmd(), [script], {
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      TTS_MODEL_DIR: modelsDir(),
      ...(home ? { COSYVOICE_HOME: home } : {})
    },
    windowsHide: true
  })
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf8')
    let idx = stdoutBuf.indexOf('\n')
    while (idx >= 0) {
      const line = stdoutBuf.slice(0, idx).trim()
      stdoutBuf = stdoutBuf.slice(idx + 1)
      if (line) handleStdoutLine(line)
      idx = stdoutBuf.indexOf('\n')
    }
  })
  child.stderr.on('data', () => {
    /* CosyVoice / torch 日志，忽略 */
  })
  child.on('error', () => {
    child = null
  })
  child.on('close', onChildExit)
}

function workerRequest(
  op: string,
  extra: Record<string, unknown>,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!child || !child.stdin.writable) {
      reject(new Error('语音引擎未运行'))
      return
    }
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      intentionalKill = true
      child?.kill('SIGKILL')
      reject(new Error('语音引擎超时'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, op, ...extra }) + '\n')
  })
}

async function stopWorker(): Promise<void> {
  if (!child) {
    rejectAll('已取消')
    return
  }
  intentionalKill = true
  try {
    child.stdin.write(JSON.stringify({ id: randomUUID(), op: 'shutdown' }) + '\n')
  } catch {
    /* ignore */
  }
  const proc = child
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve()
    }, 3000)
    proc.once('close', () => {
      clearTimeout(t)
      resolve()
    })
    try {
      proc.kill('SIGKILL')
    } catch {
      clearTimeout(t)
      resolve()
    }
  })
  child = null
  mutex = Promise.resolve()
}

function workerOk(res: Record<string, unknown>): Record<string, unknown> {
  if (res.ok === false) {
    throw new Error(typeof res.error === 'string' ? res.error : '语音引擎返回失败')
  }
  return res
}

async function readIndex(): Promise<IndexFile> {
  const p = indexPath()
  if (!existsSync(p)) {
    return { version: 1, voices: [] }
  }
  let raw: string
  try {
    raw = await readFile(p, 'utf8')
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('音色库文件损坏')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as IndexFile).version !== 1 ||
    !Array.isArray((parsed as IndexFile).voices)
  ) {
    throw new Error('音色库文件损坏')
  }
  return parsed as IndexFile
}

async function writeIndex(data: IndexFile): Promise<void> {
  await mkdir(voicesRoot(), { recursive: true })
  const tmp = indexPath() + '.tmp'
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, indexPath())
}

async function readUi(): Promise<UiFile> {
  try {
    const raw = await readFile(uiPath(), 'utf8')
    const parsed = JSON.parse(raw) as UiFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeLastOutputDir(dir: string): Promise<void> {
  await mkdir(voicesRoot(), { recursive: true })
  const ui = await readUi()
  ui.lastOutputDir = dir
  await writeFile(uiPath(), JSON.stringify(ui, null, 2), 'utf8')
}

function annotateMissing(voices: TtsVoice[]): TtsVoice[] {
  return voices.map((v) => ({
    ...v,
    missingFile: !existsSync(refWav(v.id))
  }))
}

function parseDurationMs(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const s = Number(m[3])
  const frac = m[4].padEnd(3, '0').slice(0, 3)
  return ((h * 3600 + min * 60 + s) * 1000 + Number(frac))
}

async function wavDurationMs(filePath: string): Promise<number> {
  const result = await spawnCapture('ffmpeg', ['-i', filePath, '-f', 'null', '-'])
  const ms = parseDurationMs(result.stderr + result.stdout)
  if (ms == null || !Number.isFinite(ms)) {
    throw new Error('无法读取参考音频时长')
  }
  return ms
}

function validateName(name: string): string {
  const n = name.trim()
  if (!n) throw new Error('名称不能为空')
  if (n.length > 64) throw new Error('名称最长 64 字')
  return n
}

function validateTranscript(text: string): string {
  const t = text.trim()
  if (!t) throw new Error('转写不能为空')
  if (t.length > 500) throw new Error('转写最长 500 字')
  return t
}

function validateNote(note: string | undefined): string {
  const n = (note || '').trim()
  if (n.length > 200) throw new Error('备注最长 200 字')
  return n
}

function validateFileName(name: string, format: 'wav' | 'mp3'): string {
  const base = name.trim()
  if (!base) throw new Error('文件名不能为空')
  if (base.includes('..') || base.includes('/') || base.includes('\\') || isAbsolute(base)) {
    throw new Error('文件名非法')
  }
  const stemRaw = extname(base) ? base.slice(0, -extname(base).length) : base
  if (!stemRaw) throw new Error('文件名不能为空')
  if (WIN_BAD_CHARS.test(stemRaw)) {
    throw new Error('文件名含非法字符')
  }
  return `${stemRaw}.${format}`
}

async function runFfmpeg(args: string[]): Promise<void> {
  const result = await spawnCapture('ffmpeg', args)
  if (result.error?.includes('ENOENT')) {
    throw new Error('未找到 ffmpeg，请安装并加入 PATH 后重启应用')
  }
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'FFmpeg 失败')
  }
}

let quitHooked = false
let quitting = false

function hookWillQuit(): void {
  if (quitHooked) return
  quitHooked = true
  app.on('will-quit', (e) => {
    if (quitting || !child) return
    e.preventDefault()
    quitting = true
    void stopWorker().finally(() => {
      app.quit()
    })
  })
}

function bindProgress(event: Electron.IpcMainInvokeEvent): void {
  progressTarget = event.sender
}

export function registerTtsIpc(): void {
  hookWillQuit()

  ipcMain.handle('tts:probe', async (event) => {
    bindProgress(event)
    const py = await checkPythonVersion()
    if (!py.ok) {
      return { success: false, error: py.error }
    }
    const ffmpegOk = await ffmpegAvailable()
    const ui = await readUi()
    const desktopDir = app.getPath('desktop')
    const outputFallback = getDialogDefaultDir() || desktopDir
    let lastOutputDir = ui.lastOutputDir || outputFallback
    try {
      const st = await stat(lastOutputDir)
      if (!st.isDirectory()) lastOutputDir = outputFallback
    } catch {
      lastOutputDir = outputFallback
    }
    try {
      await ensureWorker()
      const res = workerOk(
        await withMutex(() => workerRequest('probe', {}, 30_000))
      )
      crashCount = 0
      return {
        success: true,
        device: res.device,
        model: res.model,
        modelReady: res.modelReady === true,
        cosyvoiceImportOk: res.cosyvoiceImportOk === true,
        message: typeof res.message === 'string' ? res.message : '',
        lastOutputDir,
        desktopDir,
        ffmpegOk
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        lastOutputDir,
        desktopDir,
        ffmpegOk
      }
    }
  })

  ipcMain.handle('tts:downloadModel', async (event) => {
    bindProgress(event)
    return withMutex(async () => {
      try {
        await ensureWorker()
        sendProgress({ phase: 'download', message: '准备下载…' })
        workerOk(await workerRequest('download', {}, 30 * 60_000))
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  })

  ipcMain.handle('tts:list', async () => {
    try {
      const idx = await readIndex()
      return { success: true, voices: annotateMissing(idx.voices) }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'tts:import',
    async (
      _event,
      payload: { name?: string; sourcePath?: string; transcript?: string; note?: string }
    ) => {
      return withMutex(async () => {
        const id = randomUUID()
        const dir = itemDir(id)
        try {
          if (!(await ffmpegAvailable())) {
            throw new Error('未找到 ffmpeg，请安装并加入 PATH 后重启应用')
          }
          const name = validateName(String(payload?.name || ''))
          const transcript = validateTranscript(String(payload?.transcript || ''))
          const note = validateNote(payload?.note)
          const sourcePath = String(payload?.sourcePath || '')
          const ext = extname(sourcePath).replace('.', '').toLowerCase()
          if (!sourcePath || !AUDIO_EXTS.has(ext)) {
            throw new Error('请选择 wav / mp3 / m4a / flac 音频')
          }
          await mkdir(dir, { recursive: true })
          const dest = refWav(id)
          await runFfmpeg(['-y', '-i', sourcePath, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dest])
          const durationMs = await wavDurationMs(dest)
          if (durationMs < 3000 || durationMs > 30_000) {
            throw new Error('参考音频时长须为 3～30 秒')
          }
          const idx = await readIndex()
          const now = Date.now()
          idx.voices.push({ id, name, transcript, note, durationMs, createdAt: now, updatedAt: now })
          await writeIndex(idx)
          return { success: true, voice: annotateMissing([idx.voices[idx.voices.length - 1]])[0] }
        } catch (err) {
          await rm(dir, { recursive: true, force: true })
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      })
    }
  )

  ipcMain.handle(
    'tts:update',
    async (_event, payload: { id?: string; name?: string; transcript?: string; note?: string }) => {
      return withMutex(async () => {
        try {
          const id = String(payload?.id || '')
          const idx = await readIndex()
          const voice = idx.voices.find((v) => v.id === id)
          if (!voice) throw new Error('音色不存在')
          voice.name = validateName(String(payload?.name ?? voice.name))
          voice.transcript = validateTranscript(String(payload?.transcript ?? voice.transcript))
          voice.note = validateNote(payload?.note ?? voice.note)
          voice.updatedAt = Date.now()
          await writeIndex(idx)
          return { success: true, voice: annotateMissing([voice])[0] }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      })
    }
  )

  ipcMain.handle('tts:delete', async (_event, id: string) => {
    return withMutex(async () => {
      try {
        const vid = String(id || '')
        const idx = await readIndex()
        idx.voices = idx.voices.filter((v) => v.id !== vid)
        await writeIndex(idx)
        await rm(itemDir(vid), { recursive: true, force: true })
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  })

  ipcMain.handle('tts:readRef', async (_event, id: string) => {
    try {
      const vid = String(id || '')
      const file = refWav(vid)
      const root = join(voicesRoot(), 'items') + sep
      if (!file.startsWith(root) || !existsSync(file)) {
        throw new Error('参考音频不存在')
      }
      const buf = await readFile(file)
      return { success: true, mime: 'audio/wav', base64: buf.toString('base64') }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('tts:setOutputDir', async (_event, dir: string) => {
    try {
      const d = String(dir || '')
      const st = await stat(d)
      if (!st.isDirectory()) throw new Error('目录无效')
      await writeLastOutputDir(d)
      return { success: true, lastOutputDir: d }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    'tts:synthesize',
    async (
      event,
      payload: {
        voiceId?: string
        text?: string
        outputDir?: string
        fileName?: string
        format?: 'wav' | 'mp3'
        overwrite?: boolean
      }
    ) => {
      bindProgress(event)
      return withMutex(async () => {
        const tmpWav = join(getAppTempDir(), `tusi-tts-${randomUUID()}.wav`)
        try {
          const text = String(payload?.text || '')
          if (!(text.length >= 1 && text.length <= 2000)) {
            throw new Error('文本长度须为 1～2000 字')
          }
          const format = payload?.format === 'mp3' ? 'mp3' : 'wav'
          const fileName = validateFileName(String(payload?.fileName || ''), format)
          const outputDir = String(payload?.outputDir || '')
          if (!outputDir) throw new Error('请选择输出目录')
          const outputPath = join(outputDir, fileName)
          if (existsSync(outputPath) && payload?.overwrite !== true) {
            throw new Error('目标文件已存在，请勾选覆盖或更换文件名')
          }
          const idx = await readIndex()
          const voice = idx.voices.find((v) => v.id === payload?.voiceId)
          if (!voice) throw new Error('请选择音色')
          if (!existsSync(refWav(voice.id))) throw new Error('参考音频缺失，请删除后重新导入')
          if (format === 'mp3' && !(await ffmpegAvailable())) {
            throw new Error('导出 MP3 需要 FFmpeg')
          }
          await ensureWorker()
          sendProgress({ phase: 'load', message: '正在加载模型…' })
          workerOk(await workerRequest('load', {}, 5 * 60_000))
          sendProgress({ phase: 'synth', message: '正在合成…' })
          workerOk(
            await workerRequest(
              'synth',
              {
                text,
                promptWav: refWav(voice.id),
                promptText: voice.transcript,
                outWav: tmpWav
              },
              10 * 60_000
            )
          )
          crashCount = 0
          if (format === 'mp3') {
            sendProgress({ phase: 'ffmpeg', message: '正在转 MP3…' })
            const args = ['-y', '-i', tmpWav, '-codec:a', 'libmp3lame', '-q:a', '2', outputPath]
            if (payload?.overwrite !== true && existsSync(outputPath)) {
              args[0] = '-n'
            }
            await runFfmpeg(args)
          } else if (outputPath !== tmpWav) {
            if (existsSync(outputPath)) await unlink(outputPath)
            await rename(tmpWav, outputPath)
          }
          if (existsSync(tmpWav) && tmpWav !== outputPath) {
            await unlink(tmpWav).catch(() => undefined)
          }
          return { success: true, outputPath }
        } catch (err) {
          await unlink(tmpWav).catch(() => undefined)
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      })
    }
  )

  ipcMain.handle('tts:stopWorker', async () => {
    await stopWorker()
    return { success: true }
  })
}
