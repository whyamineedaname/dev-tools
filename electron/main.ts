import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, protocol, net, shell } from 'electron'
import { join, extname } from 'path'
import { pathToFileURL } from 'url'
import { spawn } from 'child_process'
import { readFile, writeFile, mkdir, readdir, access, unlink, rm, open, stat, rename } from 'fs/promises'
import { constants as fsConstants, existsSync } from 'fs'
import { createHash, generateKeyPairSync } from 'crypto'
import { promises as dns } from 'dns'
import sharp from 'sharp'
import { startSystemColorPick } from './colorPicker'

function getReaderProgressDir(): string {
  return join(app.getPath('userData'), 'reader', 'progress')
}

function getReaderAnnotationsDir(): string {
  return join(app.getPath('userData'), 'reader', 'annotations')
}

async function ensureReaderDirs(): Promise<void> {
  await mkdir(getReaderProgressDir(), { recursive: true })
  await mkdir(getReaderAnnotationsDir(), { recursive: true })
}

function progressPath(fileHash: string): string {
  if (!/^[a-f0-9]{64}$/i.test(fileHash)) {
    throw new Error('invalid fileHash')
  }
  return join(getReaderProgressDir(), `${fileHash.toLowerCase()}.json`)
}

function annotationsPath(fileHash: string): string {
  if (!/^[a-f0-9]{64}$/i.test(fileHash)) {
    throw new Error('invalid fileHash')
  }
  return join(getReaderAnnotationsDir(), `${fileHash.toLowerCase()}.json`)
}

const isDev = process.env.NODE_ENV === 'development'

// 主题背景图自定义协议：tusi-img://<filename> → userData/theme-images/<filename>
// 必须在使用前注册 scheme 特权（standard 才能被 CSS url() 正常解析）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tusi-img',
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

function getThemeImagesDir(): string {
  return join(app.getPath('userData'), 'theme-images')
}

async function ensureThemeImagesDir(): Promise<void> {
  await mkdir(getThemeImagesDir(), { recursive: true })
}

// Python 脚本目录：开发时在项目根目录，打包后在 resources 目录下
function getScriptsDir(): string {
  if (isDev) {
    // 开发模式：项目根目录下的 python-scripts
    return join(process.cwd(), 'python-scripts')
  }
  // 打包后：resources/python-scripts
  return join(process.resourcesPath, 'python-scripts')
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '兔丝',
    icon: join(__dirname, 'assets/logo.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:33445')
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  // F12 切换开发者工具；启动时默认不打开
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools()
    }
  })
}

app.whenReady().then(() => {
  // 注册 tusi-img:// 协议：把请求映射到 userData/theme-images 下的文件
  protocol.handle('tusi-img', (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'img') {
        return new Response('bad request', { status: 400 })
      }
      // 从 pathname 提取文件名，杜绝路径穿越
      const fileName = url.pathname.replace(/^\/+/, '')
      if (!/^[\w.-]+$/.test(fileName)) {
        return new Response('bad request', { status: 400 })
      }
      const filePath = join(getThemeImagesDir(), fileName)
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })

  createWindow()

  // 应用启动后后台预生成 RSA 密钥对，渲染层点击加解密时秒取，不阻塞 UI
  prewarmRsaKeys()
  void initClipboardHistory()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopClipboardWatch()
  if (process.platform !== 'darwin') app.quit()
})

// ==================== RSA 密钥对（后台预生成） ====================

interface RsaKeyPair {
  publicKeyPem: string
  privateKeyPem: string
  publicKeyB64: string
  privateKeyB64: string
}

let rsaKeyPair: RsaKeyPair | null = null
let rsaGenerating: Promise<RsaKeyPair> | null = null

// Node 原生 RSA-2048 密钥对生成（PKCS#8 私钥，与参考页面格式一致）
function generateRsaKeyPair(): RsaKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  // B64 = 去掉换行后的 PEM 内容文本的 base64（纯字符流，前端 atob 后按 64 字符切分换行）
  const b64FromPem = (pem: string) =>
    Buffer.from(
      pem
        .replace(/-----BEGIN (PUBLIC|PRIVATE) KEY-----|-----END (PUBLIC|PRIVATE) KEY-----/g, '')
        .replace(/\n/g, '')
        .trim(),
      'utf-8'
    ).toString('base64')
  return {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    publicKeyB64: b64FromPem(publicKey),
    privateKeyB64: b64FromPem(privateKey)
  }
}

// 单例：并发请求共享同一生成任务
function getRsaKeyPair(): Promise<RsaKeyPair> {
  if (rsaKeyPair) return Promise.resolve(rsaKeyPair)
  if (!rsaGenerating) {
    rsaGenerating = new Promise((resolve, reject) => {
      // 事件循环空闲后生成，避免阻塞 IPC 响应
      setImmediate(() => {
        try {
          rsaKeyPair = generateRsaKeyPair()
          resolve(rsaKeyPair)
        } catch (err) {
          reject(err)
        } finally {
          rsaGenerating = null
        }
      })
    })
  }
  return rsaGenerating
}

// 后台预生成（启动 1.5s 后执行，不干扰窗口加载）
function prewarmRsaKeys() {
  setTimeout(() => {
    getRsaKeyPair().catch((err) => console.error('预生成 RSA 密钥对失败:', err))
  }, 1500)
}

// ==================== IPC 处理 ====================

// 读取文本文件（JSON 工具等用）
ipcMain.handle('file:readText', async (_event, filePath: string): Promise<{ success: boolean; content?: string; error?: string }> => {
  try {
    const content = await readFile(filePath, 'utf-8')
    return { success: true, content }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// 读取二进制文件（文档阅读器等）
ipcMain.handle('file:readBinary', async (_event, filePath: string): Promise<{
  success: boolean
  base64?: string
  size?: number
  error?: string
}> => {
  try {
    const buf = await readFile(filePath)
    return { success: true, base64: buf.toString('base64'), size: buf.length }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

// 阅读进度：按内容哈希读写
ipcMain.handle('reader:getProgress', async (_event, fileHash: string) => {
  try {
    await ensureReaderDirs()
    const raw = await readFile(progressPath(fileHash), 'utf-8')
    return { success: true as const, data: JSON.parse(raw) }
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined
    if (code === 'ENOENT') {
      return { success: true as const, data: null }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})

ipcMain.handle('reader:saveProgress', async (_event, record: unknown) => {
  try {
    const r = record as {
      fileHash: string
      filePath: string
      fileName: string
      location: unknown
      updatedAt: number
    }
    if (!r?.fileHash || !r.location) {
      return { success: false as const, error: 'invalid record' }
    }
    await ensureReaderDirs()
    await writeFile(progressPath(r.fileHash), JSON.stringify(r, null, 2), 'utf-8')
    return { success: true as const, data: undefined as void }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})

ipcMain.handle('reader:listRecent', async (_event, limit = 10) => {
  try {
    await ensureReaderDirs()
    const dir = getReaderProgressDir()
    const names = await readdir(dir)
    const records: Array<{
      fileHash: string
      filePath: string
      fileName: string
      location:
        | { kind: 'cfi'; cfi: string; fraction?: number }
        | { kind: 'page'; page: number; fraction?: number }
      updatedAt: number
      exists: boolean
    }> = []

    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const raw = await readFile(join(dir, name), 'utf-8')
        const parsed = JSON.parse(raw) as {
          fileHash?: string
          filePath?: string
          fileName?: string
          location?: unknown
          updatedAt?: number
        }
        if (!parsed.fileHash || !parsed.filePath || !parsed.location || !parsed.updatedAt) {
          continue
        }
        let exists = false
        try {
          await access(parsed.filePath, fsConstants.R_OK)
          exists = true
        } catch {
          exists = false
        }
        records.push({
          fileHash: parsed.fileHash,
          filePath: parsed.filePath,
          fileName: parsed.fileName || parsed.filePath.split(/[/\\]/).pop() || parsed.filePath,
          location: parsed.location as
            | { kind: 'cfi'; cfi: string; fraction?: number }
            | { kind: 'page'; page: number; fraction?: number },
          updatedAt: parsed.updatedAt,
          exists
        })
      } catch {
        // skip corrupt progress files
      }
    }

    records.sort((a, b) => b.updatedAt - a.updatedAt)
    const max = Math.min(Math.max(Number(limit) || 10, 1), 50)
    return { success: true as const, data: records.slice(0, max) }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})

ipcMain.handle('reader:getAnnotations', async (_event, fileHash: string) => {
  try {
    await ensureReaderDirs()
    const raw = await readFile(annotationsPath(fileHash), 'utf-8')
    return { success: true as const, data: JSON.parse(raw) }
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined
    if (code === 'ENOENT') {
      return {
        success: true as const,
        data: {
          fileHash,
          inks: [],
          notes: [],
          updatedAt: 0
        }
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})

ipcMain.handle('reader:saveAnnotations', async (_event, doc: unknown) => {
  try {
    const d = doc as {
      fileHash: string
      inks: unknown[]
      notes: unknown[]
      updatedAt: number
    }
    if (!d?.fileHash || !Array.isArray(d.inks) || !Array.isArray(d.notes)) {
      return { success: false as const, error: 'invalid annotations doc' }
    }
    await ensureReaderDirs()
    await writeFile(
      annotationsPath(d.fileHash),
      JSON.stringify(
        {
          fileHash: d.fileHash,
          inks: d.inks,
          notes: d.notes,
          updatedAt: d.updatedAt || Date.now()
        },
        null,
        2
      ),
      'utf-8'
    )
    return { success: true as const, data: undefined as void }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})

// 获取/生成 RSA 密钥对（主进程后台生成，不阻塞渲染层）
ipcMain.handle('crypto:generateRsaKeys', async (): Promise<
  { success: true } & RsaKeyPair
  | { success: false; error: string }
> => {
  try {
    const kp = await getRsaKeyPair()
    return { success: true, ...kp }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})

// 选择文件
ipcMain.handle('dialog:openFile', async (_event, options: {
  title?: string
  filters?: { name: string; extensions: string[] }[]
} = {}) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || '选择文件',
    filters: options.filters,
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// 选择目录
ipcMain.handle('dialog:openDirectory', async (_event, title?: string) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || '选择目录',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// 保存文件路径
ipcMain.handle('dialog:saveFile', async (_event, options: {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
} = {}) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || '保存文件',
    defaultPath: options.defaultPath,
    filters: options.filters
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

// 写入 Base64 二进制（去背景导出等）
ipcMain.handle('file:writeBase64', async (_event, filePath: string, base64: string): Promise<{
  success: boolean
  error?: string
}> => {
  try {
    await writeFile(filePath, Buffer.from(base64, 'base64'))
    return { success: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

// 调用 Python 脚本（filetomd）
ipcMain.handle('python:fileToMd', async (_event, inputPath: string, outputPath: string) => {
  return runPythonScript(
    join(getScriptsDir(), 'filetomd.py'),
    [inputPath, outputPath]
  )
})

// 调用 Python 脚本（doctopdf）
ipcMain.handle('python:docToPdf', async (_event, inputPath: string, outputPath: string) => {
  return runPythonScript(
    join(getScriptsDir(), 'doctopdf_single.py'),
    [inputPath, outputPath]
  )
})

// 系统级取色（截屏覆盖层，可取任意 Windows 窗口颜色）
ipcMain.handle('color:pick', async () => {
  return startSystemColorPick(mainWindow)
})

// 检测本机是否可用 ffmpeg
ipcMain.handle('ffmpeg:check', async (): Promise<{ available: boolean; version: string; error: string }> => {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0) {
        const firstLine = (stdout || stderr).split(/\r?\n/)[0] || 'ffmpeg'
        resolve({ available: true, version: firstLine.trim(), error: '' })
      } else {
        resolve({ available: false, version: '', error: stderr.trim() || 'ffmpeg 不可用' })
      }
    })
    proc.on('error', (err) => {
      resolve({
        available: false,
        version: '',
        error: err.message.includes('ENOENT')
          ? '未找到 ffmpeg，请安装并加入 PATH 后重启应用'
          : err.message
      })
    })
  })
})

// MP4 → 动图 WebP
ipcMain.handle('ffmpeg:mp4ToWebp', async (_event, inputPath: string, outputPath: string, options: {
  fps?: number
  maxWidth?: number
  quality?: number
  startSec?: number
  durationSec?: number
} = {}) => {
  return runFfmpegMp4ToWebp(inputPath, outputPath, options)
})

// 通用音视频转码：转 MP3 / 抽音频 / 压视频
ipcMain.handle('ffmpeg:transcode', async (_event, inputPath: string, outputPath: string, options: {
  mode: 'toMp3' | 'extractAudio' | 'compressVideo'
  audioBitrate?: string
  audioCodec?: 'mp3' | 'aac' | 'wav' | 'copy'
  videoCrf?: number
  maxWidth?: number
  startSec?: number
  durationSec?: number
} = { mode: 'toMp3' }) => {
  return runFfmpegTranscode(inputPath, outputPath, options)
})

// ==================== 图片裁剪 / 缩放 ====================

interface ImageCropOptions {
  crop?: { x: number; y: number; width: number; height: number }
  maxWidth?: number
  quality?: number
  format?: 'jpeg' | 'png' | 'webp'
}

/** ICO 图标包含的尺寸列表（Windows 图标规范） */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** 把多个 PNG Buffer 打包成 ICO 容器（ICONDIR + ICONDIRENTRY + PNG 数据） */
function buildIco(pngs: Buffer[]): Buffer {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4) // image count

  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  for (let i = 0; i < count; i++) {
    const e = i * 16
    const dim = ICO_SIZES[i] ?? 0
    entries.writeUInt8(dim >= 256 ? 0 : dim, e) // width (256 → 0)
    entries.writeUInt8(dim >= 256 ? 0 : dim, e + 1) // height
    entries.writeUInt8(0, e + 2) // color count
    entries.writeUInt8(0, e + 3) // reserved
    entries.writeUInt16LE(1, e + 4) // planes
    entries.writeUInt16LE(32, e + 6) // bit count
    entries.writeUInt32LE(pngs[i].length, e + 8) // bytes in resource
    entries.writeUInt32LE(offset, e + 12) // image offset
    offset += pngs[i].length
  }

  return Buffer.concat([header, entries, ...pngs])
}

// 图片 → ICO 图标（多尺寸 PNG 打包，透明背景，保持宽高比）
ipcMain.handle('image:toIco', async (_event, inputPath: string): Promise<{
  success: boolean
  base64?: string
  error?: string
}> => {
  try {
    const pngs: Buffer[] = []
    for (const size of ICO_SIZES) {
      const buf = await sharp(inputPath, { animated: false })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer()
      pngs.push(buf)
    }
    return { success: true, base64: buildIco(pngs).toString('base64') }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: message }
  }
})

// ==================== EXIF 查看 / 清除 ====================

interface ExifTag {
  key: string
  name: string
  value: string
  group: '相机' | '拍摄参数' | '时间' | '图像' | 'GPS'
}

/** EXIF 标签 → 中文名映射（IFD0 + Exif IFD + GPS IFD 常用项） */
const EXIF_TAG_NAMES: Record<number, { name: string; group: ExifTag['group'] }> = {
  0x010f: { name: '厂商', group: '相机' },
  0x0110: { name: '型号', group: '相机' },
  0x0112: { name: '方向', group: '图像' },
  0x011a: { name: '水平分辨率', group: '图像' },
  0x011b: { name: '垂直分辨率', group: '图像' },
  0x0128: { name: '分辨率单位', group: '图像' },
  0x0131: { name: '软件', group: '相机' },
  0x0132: { name: '修改时间', group: '时间' },
  0x013b: { name: '作者', group: '相机' },
  0x8298: { name: '版权', group: '相机' },
  0x829a: { name: '曝光时间', group: '拍摄参数' },
  0x829d: { name: '光圈', group: '拍摄参数' },
  0x8822: { name: '曝光程序', group: '拍摄参数' },
  0x8827: { name: 'ISO 感光度', group: '拍摄参数' },
  0x8830: { name: '灵敏度类型', group: '拍摄参数' },
  0x9000: { name: 'Exif 版本', group: '图像' },
  0x9003: { name: '拍摄时间', group: '时间' },
  0x9004: { name: '数字化时间', group: '时间' },
  0x9101: { name: '分量配置', group: '图像' },
  0x9201: { name: '快门速度', group: '拍摄参数' },
  0x9202: { name: '光圈值', group: '拍摄参数' },
  0x9204: { name: '曝光补偿', group: '拍摄参数' },
  0x9205: { name: '测光模式', group: '拍摄参数' },
  0x9207: { name: '闪光灯', group: '拍摄参数' },
  0x9209: { name: '焦距', group: '拍摄参数' },
  0x920a: { name: '焦距', group: '拍摄参数' },
  0xa001: { name: '色彩空间', group: '图像' },
  0xa002: { name: '像素宽度', group: '图像' },
  0xa003: { name: '像素高度', group: '图像' },
  0xa005: { name: '缩略图', group: '图像' },
  0xa20e: { name: '图像描述', group: '图像' },
  0xa20f: { name: '相机备注', group: '相机' },
  0xa402: { name: '曝光模式', group: '拍摄参数' },
  0xa403: { name: '白平衡', group: '拍摄参数' },
  0xa405: { name: '焦距换算 35mm', group: '拍摄参数' },
  0xa406: { name: '场景类型', group: '拍摄参数' },
  0xa408: { name: '对比度', group: '拍摄参数' },
  0xa409: { name: '饱和度', group: '拍摄参数' },
  0xa40a: { name: '锐度', group: '拍摄参数' },
  0xa432: { name: '镜头信息', group: '相机' },
  0xa433: { name: '镜头型号', group: '相机' }
}

/** 用 TIFF 规则读取 EXIF buffer，返回常用标签 */
function parseExif(exif: Buffer): ExifTag[] {
  const tags: ExifTag[] = []
  if (exif.length < 8) return tags

  // sharp 返回的 exif buffer 可能带 "Exif\0\0" 头（6 字节），跳过后才是 TIFF 头
  let view = exif
  if (exif.length >= 6 && exif.toString('ascii', 0, 6) === 'Exif\0\0') {
    view = exif.subarray(6)
  }
  if (view.length < 8) return tags

  const endian = view.toString('ascii', 0, 2)
  const little = endian === 'II'
  if (endian !== 'II' && endian !== 'MM') return tags
  // TIFF header: magic(2) + IFD0 offset(4)
  if (view.readUInt16LE(2) !== 42 && view.readUInt16BE(2) !== 42) return tags

  const readU16 = (off: number) => (little ? view.readUInt16LE(off) : view.readUInt16BE(off))
  const readU32 = (off: number) => (little ? view.readUInt32LE(off) : view.readUInt32BE(off))
  const readS32 = (off: number) => (little ? view.readInt32LE(off) : view.readInt32BE(off))

  const ifd0Offset = readU32(4)
  if (ifd0Offset >= view.length) return tags

  const sizeOf = (t: number): number => {
    switch (t) {
      case 1: case 2: case 6: case 7: return 1 // BYTE / ASCII / SBYTE / UNDEFINED
      case 3: case 8: return 2 // SHORT / SSHORT
      case 4: case 9: return 4 // LONG / SLONG
      case 5: case 10: return 8 // RATIONAL / SRATIONAL
      default: return 1
    }
  }

  const valueAt = (tag: number, type: number, count: number, offset: number): string => {
    const total = sizeOf(type) * count
    // 若 count*size > 4，字段的 4 字节区存的是指向值区的偏移
    const dataPos = total > 4 ? readU32(offset) : offset
    if (total > 4 && (dataPos + total > view.length || dataPos < 0)) return ''

    const num = (pos: number) =>
      type === 3 ? readU16(pos) : type === 4 ? readU32(pos) : type === 9 ? readS32(pos) : NaN

    switch (type) {
      case 2: // ASCII
        return view.toString('ascii', dataPos, dataPos + Math.min(count, 64)).replace(/\0+$/, '').trim()
      case 1: // BYTE
      case 3: // SHORT
      case 4: // LONG
      case 9: { // SLONG
        if (count === 1) return String(num(dataPos))
        const arr: number[] = []
        for (let i = 0; i < Math.min(count, 16); i++) arr.push(num(dataPos + i * sizeOf(type)))
        return arr.join(', ')
      }
      case 5: { // RATIONAL (numerator/denominator, 各 4 字节) —— 保留分数形式避免精度损失
        if (count === 1) {
          const n = readU32(dataPos)
          const d = readU32(dataPos + 4)
          if (d === 0) return ''
          return n % d === 0 ? String(n / d) : `${n}/${d}`
        }
        const arr: string[] = []
        for (let i = 0; i < Math.min(count, 8); i++) {
          const n = readU32(dataPos + i * 8)
          const d = readU32(dataPos + i * 8 + 4)
          arr.push(d === 0 ? '0' : n % d === 0 ? String(n / d) : `${n}/${d}`)
        }
        return arr.join(', ')
      }
      case 10: { // SRATIONAL
        const n = readS32(dataPos)
        const d = readS32(dataPos + 4)
        if (d === 0) return ''
        return `${n}/${d}`
      }
      case 7: // UNDEFINED
        return tag === 0x9000
          ? view.toString('ascii', dataPos, dataPos + Math.min(count, 8))
          : `[${count} 字节]`
      default:
        return ''
    }
  }

  const readIfd = (ifdOffset: number): void => {
    if (ifdOffset + 2 > view.length) return
    const entryCount = readU16(ifdOffset)
    let nextExifIfd = 0
    let nextGpsIfd = 0
    for (let i = 0; i < entryCount; i++) {
      const entryPos = ifdOffset + 2 + i * 12
      if (entryPos + 12 > view.length) break
      const tag = readU16(entryPos)
      const type = readU16(entryPos + 2)
      const count = readU32(entryPos + 4)
      const offset = entryPos + 8
      // 子 IFD 指针：ExifIFD(0x8769) / GPSInfo(0x8825)
      if (tag === 0x8769 && count === 1) { nextExifIfd = readU32(offset); continue }
      if (tag === 0x8825 && count === 1) { nextGpsIfd = readU32(offset); continue }

      const meta = EXIF_TAG_NAMES[tag]
      const raw = valueAt(tag, type, count, offset)
      if (!raw) continue
      // GPS 特殊处理（度分秒 RATIONAL×3）
      if (tag >= 0x0001 && tag <= 0x0004 && type === 5 && count === 3) {
        tags.push({ key: `gps_${tag.toString(16)}`, name: GPS_TAG_NAMES[tag] || `GPS ${tag}`, value: raw, group: 'GPS' })
        continue
      }
      // GPS 非数值标签（如参考方向 N/S/E/W）
      const gpsName = GPS_TAG_NAMES[tag]
      if (gpsName) {
        tags.push({ key: `gps_${tag.toString(16)}`, name: gpsName, value: raw, group: 'GPS' })
        continue
      }
      tags.push({
        key: `${tag.toString(16).padStart(4, '0')}`,
        name: meta?.name || `标签 0x${tag.toString(16).padStart(4, '0')}`,
        value: raw,
        group: meta?.group || '图像'
      })
    }
    if (nextExifIfd) readIfd(nextExifIfd)
    if (nextGpsIfd) readIfd(nextGpsIfd)
  }

  readIfd(ifd0Offset)
  return tags
}

const GPS_TAG_NAMES: Record<number, string> = {
  0x0000: 'GPS 版本',
  0x0001: '纬度参考',
  0x0002: '纬度',
  0x0003: '经度参考',
  0x0004: '经度',
  0x0005: '海拔参考',
  0x0006: '海拔'
}

/** 格式化曝光时间："1/200" → "1/200 秒"；"2" → "2 秒" */
function formatExposure(raw: string, tag: number): string {
  if (tag !== 0x829a) return raw
  const m = raw.match(/^(\d+)\/(\d+)$/)
  if (m) {
    const n = Number(m[1])
    const d = Number(m[2])
    if (d === 0) return raw
    return n === 1 ? `1/${d} 秒` : `${n}/${d} 秒`
  }
  const v = Number(raw)
  if (Number.isFinite(v)) return `${v} 秒`
  return raw
}

/** 方向 (Orientation) 数值 → 中文描述 */
function formatOrientation(raw: string, tag: number): string {
  if (tag !== 0x0112) return raw
  const map: Record<string, string> = {
    '1': '正常',
    '2': '水平翻转',
    '3': '旋转 180°',
    '4': '垂直翻转',
    '5': '水平翻转 + 旋转 90°',
    '6': '顺时针旋转 90°',
    '7': '水平翻转 + 旋转 270°',
    '8': '逆时针旋转 90°'
  }
  return map[raw] || raw
}

// 查看 EXIF 信息
ipcMain.handle('image:exif', async (_event, inputPath: string): Promise<
  | { success: true; data: { format: string; width: number; height: number; byteSize: number; hasExif: boolean; tags: ExifTag[] } }
  | { success: false; error: string }
> => {
  try {
    const meta = await sharp(inputPath).metadata()
    const tags: ExifTag[] = meta.exif ? parseExif(meta.exif) : []
    const statResult = await stat(inputPath).catch(() => null)
    return {
      success: true,
      data: {
        format: meta.format || '',
        width: meta.width || 0,
        height: meta.height || 0,
        byteSize: statResult?.size || 0,
        hasExif: Boolean(meta.exif),
        tags: tags.map((t) => ({
          ...t,
          value: formatExposure(formatOrientation(t.value, parseInt(t.key, 16)), parseInt(t.key, 16))
        }))
      }
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// 清除 EXIF：sharp 重编码（默认剥离元数据），原子替换原文件
ipcMain.handle('image:clearExif', async (_event, inputPath: string): Promise<
  | { success: true; data: { byteSize: number } }
  | { success: false; error: string }
> => {
  const src = String(inputPath || '')
  if (!src) return { success: false, error: '参数缺失' }
  const tmp = `${src}.tusi-clear-${Date.now()}.tmp`
  try {
    // 按原格式重编码（JPEG 默认丢 EXIF；PNG/WebP 同样剥离）
    const meta = await sharp(src, { animated: true }).metadata()
    const format = meta.format || 'jpeg'
    let pipeline = sharp(src, { animated: true })
    if (format === 'png') pipeline = pipeline.png()
    else if (format === 'webp') pipeline = pipeline.webp()
    else pipeline = pipeline.jpeg({ quality: 95 })
    await pipeline.toFile(tmp)
    await rename(tmp, src)
    const statResult = await stat(src)
    return { success: true, data: { byteSize: statResult.size } }
  } catch (e: unknown) {
    await unlink(tmp).catch(() => undefined)
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// ==================== 拼图 ====================

interface PuzzleItem {
  path: string
  x: number // 归一化 0-1
  y: number // 归一化 0-1
  width: number // 归一化 0-1
  height: number // 归一化 0-1
}

/** 把图片按 cover 裁剪并缩放到指定尺寸，返回 PNG buffer */
async function coverResize(input: string | Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(input)
    .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), {
      fit: 'cover',
      position: 'centre'
    })
    .png()
    .toBuffer()
}

/** 取图片等比缩放后的宽高（fit: inside） */
async function insideSize(input: string, target: number, dim: 'width' | 'height'): Promise<{ w: number; h: number }> {
  const meta = await sharp(input).metadata()
  const W = meta.width || 1
  const H = meta.height || 1
  const scale = dim === 'width' ? target / W : target / H
  return { w: Math.max(1, Math.round(W * scale)), h: Math.max(1, Math.round(H * scale)) }
}

// 拼图：grid（九宫/四格等网格）、hstack（左右）、vstack（长图）、free（自由画布）
ipcMain.handle('image:puzzle', async (_event, payload: {
  mode: 'grid' | 'hstack' | 'vstack' | 'free'
  paths?: string[]
  items?: PuzzleItem[]
  gap?: number
  background?: string
  cols?: number
  rows?: number
  cellSize?: number
  canvasWidth?: number
  canvasHeight?: number
}): Promise<
  | { success: true; base64: string; width: number; height: number }
  | { success: false; error: string }
> => {
  try {
    const gap = Math.max(0, Math.min(80, Number(payload?.gap) || 0))
    const bg = payload?.background || '#ffffff'
    const layers: { input: Buffer; left: number; top: number }[] = []

    if (payload?.mode === 'grid') {
      const paths = (payload.paths || []).filter(Boolean)
      if (!paths.length) return { success: false, error: '请先添加图片' }
      const cols = Math.max(1, Math.min(8, Number(payload.cols) || 3))
      const rows = Math.max(1, Math.min(8, Number(payload.rows) || 3))
      const cell = Math.max(50, Math.min(2000, Number(payload.cellSize) || 500))
      const canvasW = cols * cell + gap * (cols - 1)
      const canvasH = rows * cell + gap * (rows - 1)
      const maxCount = cols * rows
      const used = Math.min(paths.length, maxCount)
      for (let i = 0; i < used; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        const buf = await coverResize(paths[i], cell, cell)
        layers.push({ input: buf, left: col * (cell + gap), top: row * (cell + gap) })
      }
      const out = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: bg } })
        .composite(layers)
        .png()
        .toBuffer()
      return { success: true, base64: out.toString('base64'), width: canvasW, height: canvasH }
    }

    if (payload?.mode === 'hstack') {
      const paths = (payload.paths || []).filter(Boolean)
      if (!paths.length) return { success: false, error: '请先添加图片' }
      // 统一高度：取最高一张（限制 1600px），每张等比缩放
      const sizes = await Promise.all(paths.map((p) => sharp(p).metadata()))
      const maxH = Math.min(1600, Math.max(...sizes.map((m) => m.height || 1)))
      let x = 0
      for (const p of paths) {
        const { w, h } = await insideSize(p, maxH, 'height')
        const buf = await coverResize(p, w, h)
        layers.push({ input: buf, left: x, top: 0 })
        x += w + gap
      }
      const canvasW = Math.max(1, x - (paths.length ? gap : 0))
      const out = await sharp({ create: { width: canvasW, height: maxH, channels: 4, background: bg } })
        .composite(layers)
        .png()
        .toBuffer()
      return { success: true, base64: out.toString('base64'), width: canvasW, height: maxH }
    }

    if (payload?.mode === 'vstack') {
      const paths = (payload.paths || []).filter(Boolean)
      if (!paths.length) return { success: false, error: '请先添加图片' }
      // 统一宽度：取最宽一张（限制 1600px），每张等比缩放
      const sizes = await Promise.all(paths.map((p) => sharp(p).metadata()))
      const maxW = Math.min(1600, Math.max(...sizes.map((m) => m.width || 1)))
      let y = 0
      for (const p of paths) {
        const { w, h } = await insideSize(p, maxW, 'width')
        const buf = await coverResize(p, w, h)
        layers.push({ input: buf, left: 0, top: y })
        y += h + gap
      }
      const canvasH = Math.max(1, y - (paths.length ? gap : 0))
      const out = await sharp({ create: { width: maxW, height: canvasH, channels: 4, background: bg } })
        .composite(layers)
        .png()
        .toBuffer()
      return { success: true, base64: out.toString('base64'), width: maxW, height: canvasH }
    }

    if (payload?.mode === 'free') {
      const items = (payload.items || []).filter((i) => i && i.path)
      if (!items.length) return { success: false, error: '请先添加图片' }
      const canvasW = Math.max(100, Math.min(4000, Math.round(Number(payload.canvasWidth) || 1080)))
      const canvasH = Math.max(100, Math.min(4000, Math.round(Number(payload.canvasHeight) || 1080)))
      for (const item of items) {
        const w = Math.max(20, Math.round(item.width * canvasW))
        const h = Math.max(20, Math.round(item.height * canvasH))
        const buf = await coverResize(item.path, w, h)
        layers.push({
          input: buf,
          left: Math.max(0, Math.round(item.x * canvasW)),
          top: Math.max(0, Math.round(item.y * canvasH))
        })
      }
      const out = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: bg } })
        .composite(layers)
        .png()
        .toBuffer()
      return { success: true, base64: out.toString('base64'), width: canvasW, height: canvasH }
    }

    return { success: false, error: '未知的拼图模式' }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// ==================== 人声分离 ====================

// 当前运行中的分离子进程，用于取消
let activeSeparateProc: ReturnType<typeof spawn> | null = null

interface SeparateProgress {
  stage: string
  percent: number
  message: string
}

interface SeparateResult {
  success: boolean
  outputDir?: string
  files?: { name: string; path: string; label: string }[]
  error?: string
}

ipcMain.handle('audio:separate', async (_event, payload: {
  inputPath: string
  outputDir: string
  mode: '2stem' | '4stem'
  toMp3?: boolean
}): Promise<{ success: boolean; outputDir?: string; files?: { name: string; path: string; label: string }[]; error?: string }> => {
  const { inputPath, outputDir, mode } = payload || {}
  if (!inputPath || !outputDir || !mode) {
    return { success: false, error: '参数缺失' }
  }

  return new Promise((resolve) => {
    const scriptPath = join(getScriptsDir(), 'separate_audio.py')
    const args = [scriptPath, inputPath, outputDir, mode]
    if (payload.toMp3) args.push('--mp3')

    const proc = spawn('python', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    activeSeparateProc = proc

    let buffer = ''
    let result: SeparateResult | null = null
    let settled = false

    const finish = (res: { success: boolean; outputDir?: string; files?: { name: string; path: string; label: string }[]; error?: string }) => {
      if (settled) return
      settled = true
      if (activeSeparateProc === proc) activeSeparateProc = null
      resolve(res)
    }

    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      let nlIdx: number
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).trim()
        buffer = buffer.slice(nlIdx + 1)
        if (!line) continue
        try {
          const parsed = JSON.parse(line) as SeparateProgress | SeparateResult
          if ('stage' in parsed) {
            mainWindow?.webContents.send('audio:progress', {
              stage: parsed.stage,
              percent: parsed.percent,
              message: parsed.message
            })
          } else if ('success' in parsed) {
            result = parsed as SeparateResult
          }
        } catch {
          // 非 JSON 行（如 demucs 的 tqdm/stderr 杂讯）忽略
        }
      }
    })

    proc.stderr.on('data', () => {
      // stderr 仅作日志，不解析；最终结果以 stdout JSON 为准
    })

    proc.on('error', (err) => {
      finish({
        success: false,
        error: err.message.includes('ENOENT')
          ? '未找到 python，请安装 Python 3 并加入 PATH 后重启应用'
          : err.message
      })
    })

    proc.on('close', (code) => {
      if (result?.success) {
        finish({ success: true, outputDir: result.outputDir, files: result.files })
      } else {
        finish({
          success: false,
          error: result?.error || `分离进程异常退出（code ${code}）`
        })
      }
    })
  })
})

ipcMain.handle('audio:cancel', () => {
  if (activeSeparateProc) {
    activeSeparateProc.kill()
    activeSeparateProc = null
    return { success: true as const }
  }
  return { success: false as const, error: '没有正在运行的分离任务' }
})

ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
  try {
    const err = await shell.openPath(targetPath)
    return { success: !err, error: err || '' }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
})

// ==================== 主题背景图 ====================

// 前端上传主题背景图：原样保存为文件（保留 webp 动图效果），返回 tusi-img:// URL
ipcMain.handle('theme:saveImage', async (_event, payload: {
  name: string
  base64: string
}): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    const ext = (extname(payload?.name || '') || '.png').toLowerCase()
    if (!/^\.(png|jpe?g|webp|gif|bmp)$/.test(ext)) {
      return { success: false, error: `不支持的图片格式：${ext || '未知'}` }
    }
    await ensureThemeImagesDir()
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    await writeFile(join(getThemeImagesDir(), fileName), Buffer.from(payload.base64, 'base64'))
    // 使用 `tusi-img://img/<文件名>` 形式：standard scheme 下 hostname 固定为 img，文件名在 pathname
    return { success: true, url: `tusi-img://img/${fileName}` }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

ipcMain.handle('image:metadata', async (_event, inputPath: string) => {
  try {
    const meta = await sharp(inputPath, { animated: true }).metadata()
    const width = meta.width || 0
    const height = meta.pageHeight || meta.height || 0
    return {
      success: true as const,
      data: {
        width,
        height,
        pages: meta.pages || 1,
        animated: (meta.pages || 1) > 1,
        format: meta.format || ''
      }
    }
  } catch (e: unknown) {
    return { success: false as const, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('image:cropResize', async (
  _event,
  inputPath: string,
  options: ImageCropOptions
) => {
  try {
    const meta = await sharp(inputPath, { animated: true }).metadata()
    const sourceWidth = meta.width || 0
    const sourceHeight = meta.pageHeight || meta.height || 0
    if (!sourceWidth || !sourceHeight) throw new Error('无法读取图片尺寸')

    const raw = options.crop || {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight
    }
    const left = Math.max(0, Math.min(sourceWidth - 1, Math.round(raw.x)))
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.round(raw.y)))
    const cropWidth = Math.max(1, Math.min(sourceWidth - left, Math.round(raw.width)))
    const cropHeight = Math.max(1, Math.min(sourceHeight - top, Math.round(raw.height)))
    const maxWidth = Math.max(1, Math.round(options.maxWidth || cropWidth))
    const outWidth = Math.min(cropWidth, maxWidth)
    const outHeight = Math.max(1, Math.round((cropHeight * outWidth) / cropWidth))
    const quality = Math.max(1, Math.min(100, Math.round(options.quality || 80)))
    const pages = meta.pages || 1
    const animated = pages > 1
    const outputFormat = animated ? 'webp' : (options.format || 'jpeg')

    let output: Buffer
    if (animated) {
      const frames: Buffer[] = []
      for (let page = 0; page < pages; page++) {
        const frame = await sharp(inputPath, { page, pages: 1 })
          .extract({ left, top, width: cropWidth, height: cropHeight })
          .resize(outWidth, outHeight, { fit: 'fill' })
          .png()
          .toBuffer()
        frames.push(frame)
      }
      output = await sharp(frames, { join: { animated: true } })
        .webp({
          quality,
          loop: meta.loop ?? 0,
          delay: meta.delay?.length ? meta.delay : 100
        })
        .toBuffer()
    } else {
      let pipeline = sharp(inputPath)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .resize(outWidth, outHeight, { fit: 'fill' })
      if (outputFormat === 'png') {
        pipeline = pipeline.png({ quality })
      } else if (outputFormat === 'webp') {
        pipeline = pipeline.webp({ quality })
      } else {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true })
      }
      output = await pipeline.toBuffer()
    }

    return {
      success: true as const,
      data: {
        base64: output.toString('base64'),
        width: outWidth,
        height: outHeight,
        byteSize: output.length,
        animated,
        format: outputFormat
      }
    }
  } catch (e: unknown) {
    return { success: false as const, error: e instanceof Error ? e.message : String(e) }
  }
})

// ==================== HTTP 客户端 ====================

ipcMain.handle('http:request', async (_event, options: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}) => {
  const method = String(options?.method || 'GET').toUpperCase()
  const url = String(options?.url || '').trim()
  const timeoutMs = Math.min(120000, Math.max(1000, Number(options?.timeoutMs) || 30000))
  if (!url) return { success: false as const, error: '请输入 URL', elapsedMs: 0 }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { success: false as const, error: 'URL 格式无效', elapsedMs: 0 }
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { success: false as const, error: '仅支持 http/https', elapsedMs: 0 }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const headers = { ...(options?.headers || {}) }
    const hasBody = !['GET', 'HEAD'].includes(method)
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? (options?.body ?? '') : undefined,
      signal: controller.signal,
      redirect: 'follow'
    })
    const body = await res.text()
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    return {
      success: true as const,
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body,
      elapsedMs: Date.now() - started
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      success: false as const,
      error: msg.includes('abort') ? `请求超时（${timeoutMs} ms）` : msg,
      elapsedMs: Date.now() - started
    }
  } finally {
    clearTimeout(timer)
  }
})

// ==================== B 站视频下载 ====================

const BILI_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com/'
}

/** wbi 签名所需的 64 位混淆表（B 站公开算法） */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]

function getMixinKey(orig: string): string {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32)
}

async function fetchBiliJson(url: string, cookie = ''): Promise<{ data?: unknown; code: number; message?: string }> {
  const headers: Record<string, string> = { ...BILI_HEADERS }
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  const json = (await res.json()) as { code?: number; message?: string; data?: unknown }
  return { data: json.data, code: json.code ?? -1, message: json.message }
}

/** 获取 wbi key 并生成签名参数（避免 -412 风控） */
async function getWbiSignedQuery(
  params: Record<string, string | number>,
  cookie = ''
): Promise<string> {
  const headers: Record<string, string> = { ...BILI_HEADERS }
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers,
    signal: AbortSignal.timeout(15000)
  })
  const json = (await res.json()) as {
    data?: { wbi_img?: { img_url?: string; sub_url?: string } }
  }
  const imgUrl = json.data?.wbi_img?.img_url || ''
  const subUrl = json.data?.wbi_img?.sub_url || ''
  const imgKey = imgUrl.split('/').pop()?.split('.')[0] || ''
  const subKey = subUrl.split('/').pop()?.split('.')[0] || ''
  if (!imgKey || !subKey) throw new Error('获取 wbi key 失败')
  const mixinKey = getMixinKey(imgKey + subKey)

  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    query[key] = String(value)
  }
  query['wts'] = String(Math.floor(Date.now() / 1000))
  // 过滤 B 站规定字符
  const filtered = Object.fromEntries(
    Object.entries(query).filter(([, v]) => !/['!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\s]/.test(v))
  )
  const sorted = Object.keys(filtered).sort().map((k) => `${k}=${encodeURIComponent(filtered[k])}`).join('&')
  const wRid = createHash('md5').update(sorted + mixinKey).digest('hex')
  return `${sorted}&w_rid=${wRid}`
}

/** 从输入文本解析视频标识，支持 BV 号 / av 号 / 完整 URL（含分P参数） */
function parseBiliInput(input: string): {
  kind: 'video' | 'unsupported'
  bvid?: string
  aid?: string
  page?: number
  error?: string
} {
  const text = input.trim()
  // 番剧 EP / MD 号：暂不支持
  if (/ep\d+/i.test(text) || /md\d+/i.test(text)) {
    return { kind: 'unsupported', error: '暂不支持番剧（EP/MD）下载，仅支持普通视频（BV/av 号或视频链接）' }
  }
  const bvMatch = text.match(/BV[0-9A-Za-z]{10}/)
  if (bvMatch) {
    const pageMatch = text.match(/[?&]p=(\d+)/) || text.match(/\/video\/[^/]+\/(\d+)/)
    return {
      kind: 'video',
      bvid: bvMatch[0],
      page: pageMatch ? Number(pageMatch[1]) : 1
    }
  }
  const avMatch = text.match(/av(\d+)/i) || text.match(/\/av(\d+)/i)
  if (avMatch) {
    return { kind: 'video', aid: avMatch[1], page: 1 }
  }
  return { kind: 'unsupported', error: '未能识别视频地址，请粘贴 BV 号、av 号或完整视频链接' }
}

interface BiliVideoInfo {
  bvid: string
  aid: string
  title: string
  cover: string
  owner: string
  desc: string
  duration: number
  pages: Array<{ cid: number; page: number; part: string; duration: number }>
}

/** 查询视频信息（x/web-interface/view） */
async function queryBiliInfo(
  input: string,
  cookie = ''
): Promise<{ success: true; data: BiliVideoInfo & { parsedPage?: number } } | { success: false; error: string }> {
  try {
    const parsed = parseBiliInput(input)
    if (parsed.kind === 'unsupported') return { success: false, error: parsed.error || '无法解析地址' }
    const params: Record<string, string | number> = {}
    if (parsed.bvid) params['bvid'] = parsed.bvid
    if (parsed.aid) params['aid'] = parsed.aid
    const qs = new URLSearchParams(params as Record<string, string>).toString()
    const result = await fetchBiliJson(`https://api.bilibili.com/x/web-interface/view?${qs}`, cookie)
    if (result.code !== 0 || !result.data) {
      return { success: false, error: result.message || `查询失败（code ${result.code}）` }
    }
    const d = result.data as {
      bvid: string
      aid: number
      title: string
      pic: string
      owner?: { name?: string }
      desc?: string
      duration?: number
      pages?: Array<{ cid: number; page: number; part: string; duration: number }>
    }
    const info: BiliVideoInfo = {
      bvid: d.bvid,
      aid: String(d.aid),
      title: d.title || '未知标题',
      cover: d.pic || '',
      owner: d.owner?.name || '未知 UP 主',
      desc: d.desc || '',
      duration: d.duration || 0,
      pages: d.pages?.length
        ? d.pages
        : [{ cid: 0, page: 1, part: '正片', duration: d.duration || 0 }]
    }
    return { success: true, data: { ...info, parsedPage: parsed.page || 1 } }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

interface BiliDashVideo {
  id: number
  baseUrl: string
  backupUrl?: string[]
  width: number
  height: number
  bandwidth: number
  codecs?: string
}
interface BiliDashAudio {
  id: number
  baseUrl: string
  backupUrl?: string[]
  bandwidth: number
}

/** 获取播放流（x/player/wbi/playurl，DASH 音视频分离） */
async function queryBiliStreams(
  bvid: string,
  cid: number,
  cookie = ''
): Promise<
  | { success: true; data: { videos: BiliDashVideo[]; audios: BiliDashAudio[]; acceptQuality: number[] } }
  | { success: false; error: string }
> {
  try {
    const qs = await getWbiSignedQuery({ bvid, cid, fnval: 16, fourk: 1 }, cookie)
    const result = await fetchBiliJson(
      `https://api.bilibili.com/x/player/wbi/playurl?${qs}`,
      cookie
    )
    if (result.code !== 0 || !result.data) {
      return { success: false, error: result.message || `获取播放流失败（code ${result.code}）` }
    }
    const d = result.data as {
      dash?: { video?: BiliDashVideo[]; audio?: BiliDashAudio[] }
      accept_quality?: number[]
    }
    const videos = d.dash?.video || []
    const audios = d.dash?.audio || []
    if (!videos.length || !audios.length) {
      return { success: false, error: '未获取到可用播放流（可能需要登录 cookie 或该视频不可下载）' }
    }
    return {
      success: true,
      data: {
        videos,
        audios,
        acceptQuality: d.accept_quality || []
      }
    }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 带进度推送的单文件下载 */
async function downloadStream(
  url: string,
  filePath: string,
  cookie: string,
  onProgress: (received: number, total: number) => void
): Promise<void> {
  const headers: Record<string, string> = { ...BILI_HEADERS }
  if (cookie) headers['Cookie'] = cookie
  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`下载失败（HTTP ${res.status}）`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  const file = await open(filePath, 'w')
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        await file.write(value)
        received += value.length
        onProgress(received, total)
      }
    }
  } finally {
    await file.close()
  }
}

/** ffmpeg 无损合并音视频流（-c copy） */
function mergeDashWithFfmpeg(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<{ success: boolean; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-i', audioPath,
      '-c', 'copy',
      outputPath
    ])
    let stderr = ''
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, error: '' })
        return
      }
      resolve({
        success: false,
        error: stderr.trim() || `ffmpeg 合并失败（退出码 ${code}）`
      })
    })
    proc.on('error', (err) => {
      resolve({
        success: false,
        error: err.message.includes('ENOENT')
          ? '未找到 ffmpeg，请安装并加入 PATH 后重启应用'
          : err.message
      })
    })
  })
}

// 查询视频信息
ipcMain.handle('bili:info', async (_event, input: string, cookie = '') =>
  queryBiliInfo(String(input || ''), String(cookie || ''))
)

// 查询播放流（按分P cid）
ipcMain.handle('bili:streams', async (_event, payload: {
  bvid: string
  cid: number
  cookie?: string
}) => {
  const bvid = String(payload?.bvid || '')
  const cid = Number(payload?.cid) || 0
  if (!bvid || !cid) return { success: false as const, error: '参数缺失' }
  return queryBiliStreams(bvid, cid, String(payload?.cookie || ''))
})

// 下载并合并：选择清晰度（videoId 匹配 DASH 视频流，缺省选最高带宽）
ipcMain.handle('bili:download', async (_event, payload: {
  bvid: string
  cid: number
  videoUrl: string
  audioUrl: string
  cookie?: string
  outputPath: string
  title?: string
}) => {
  const { videoUrl, audioUrl, outputPath } = payload || {}
  if (!videoUrl || !audioUrl || !outputPath) {
    return { success: false as const, error: '参数缺失' }
  }
  const cookie = String(payload.cookie || '')
  const tmpDir = join(app.getPath('temp'), `tusi-bili-${Date.now()}`)
  try {
    await mkdir(tmpDir, { recursive: true })
    const vPath = join(tmpDir, 'video.m4s')
    const aPath = join(tmpDir, 'audio.m4s')
    mainWindow?.webContents.send('bili:progress', {
      phase: 'downloading', received: 0, total: 0, label: '下载视频流…'
    })
    await downloadStream(videoUrl, vPath, cookie, (received, total) => {
      mainWindow?.webContents.send('bili:progress', {
        phase: 'downloading', received, total, label: '下载视频流…'
      })
    })
    mainWindow?.webContents.send('bili:progress', {
      phase: 'downloading', received: 0, total: 0, label: '下载音频流…'
    })
    await downloadStream(audioUrl, aPath, cookie, (received, total) => {
      mainWindow?.webContents.send('bili:progress', {
        phase: 'downloading', received, total, label: '下载音频流…'
      })
    })
    mainWindow?.webContents.send('bili:progress', {
      phase: 'merging', received: 0, total: 0, label: 'ffmpeg 合并音视频…'
    })
    const merged = await mergeDashWithFfmpeg(vPath, aPath, outputPath)
    if (!merged.success) {
      return { success: false as const, error: merged.error }
    }
    return { success: true as const, outputPath }
  } catch (e: unknown) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : String(e)
    }
  } finally {
    // 清理临时文件
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
})

// ==================== 端口占用 / DNS ====================

interface PortRow {
  protocol: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += d.toString() })
    proc.stderr.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    proc.on('error', (err) => resolve({ code: 1, stdout: '', stderr: err.message }))
  })
}

async function resolveProcessNames(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  const unique = [...new Set(pids.filter((p) => p > 0))]
  await Promise.all(
    unique.map(async (pid) => {
      const result = await runCommand('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      if (result.code !== 0 || !result.stdout.trim()) {
        map.set(pid, '')
        return
      }
      // "name.exe","1234","Session","1","12,345 K"
      const line = result.stdout.trim().split(/\r?\n/)[0] || ''
      const m = line.match(/^"([^"]+)"/)
      map.set(pid, m?.[1] || '')
    })
  )
  return map
}

async function listWindowsPorts(port?: number): Promise<PortRow[]> {
  // 注意：不能用 -p tcp，它只显示 IPv4 TCP；vite 等工具监听在 IPv6（[::1]）时会被漏掉
  const args = ['-ano']
  const result = await runCommand('netstat', args)
  if (result.code !== 0 && !result.stdout.trim()) {
    throw new Error(result.stderr.trim() || 'netstat 执行失败')
  }
  const rows: PortRow[] = []
  const lines = result.stdout.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('TCP')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 5) continue
    const local = parts[1]
    const remote = parts[2]
    const state = parts[3]
    const pid = Number(parts[4])
    const localColon = local.lastIndexOf(':')
    const remoteColon = remote.lastIndexOf(':')
    if (localColon < 0 || remoteColon < 0) continue
    const localAddress = local.slice(0, localColon)
    const localPort = Number(local.slice(localColon + 1))
    const remoteAddress = remote.slice(0, remoteColon)
    const remotePort = Number(remote.slice(remoteColon + 1))
    if (!Number.isFinite(localPort) || !Number.isFinite(pid)) continue
    if (typeof port === 'number' && port > 0 && localPort !== port) continue
    rows.push({
      protocol: 'TCP',
      localAddress,
      localPort,
      remoteAddress,
      remotePort: Number.isFinite(remotePort) ? remotePort : 0,
      state,
      pid,
      processName: ''
    })
  }
  const names = await resolveProcessNames(rows.map((r) => r.pid))
  for (const row of rows) {
    row.processName = names.get(row.pid) || ''
  }
  rows.sort((a, b) => a.localPort - b.localPort || a.pid - b.pid)
  return rows
}

ipcMain.handle('net:listPorts', async (_event, port?: number) => {
  try {
    const target =
      typeof port === 'number' && Number.isFinite(port) && port > 0
        ? Math.floor(port)
        : undefined
    const data = await listWindowsPorts(target)
    return { success: true as const, data }
  } catch (e: unknown) {
    return { success: false as const, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('net:killPid', async (_event, pid: number) => {
  const id = Math.floor(Number(pid))
  if (!Number.isFinite(id) || id <= 0) {
    return { success: false as const, error: '无效 PID' }
  }
  if (id === process.pid) {
    return { success: false as const, error: '不能结束当前应用进程' }
  }
  const result = await runCommand('taskkill', ['/PID', String(id), '/F'])
  if (result.code === 0) return { success: true as const }
  return {
    success: false as const,
    error: result.stderr.trim() || result.stdout.trim() || '结束进程失败'
  }
})

ipcMain.handle('net:dnsLookup', async (_event, hostname: string, types?: string[]): Promise<
  | { success: true; data: { hostname: string; records: Array<{ type: string; value: string }> } }
  | { success: false; error: string }
> => {
  const logLine = (msg: string) => {
    try {
      const { appendFileSync } = require('fs') as typeof import('fs')
      appendFileSync(join(app.getPath('userData'), 'dns-debug.log'), `[${new Date().toISOString()}] ${msg}\n`)
    } catch {
      /* 日志失败不影响功能 */
    }
  }
  logLine(`CALL hostname=${JSON.stringify(hostname)} types=${JSON.stringify(types)}`)
  try {
    const host = String(hostname || '').trim().replace(/^https?:\/\//i, '').split('/')[0]
    if (!host) return { success: false, error: '请输入域名' }
    const wanted = (types && types.length ? types : ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS']).map((t) =>
      String(t || '').toUpperCase()
    )
    const records: Array<{ type: string; value: string }> = []
    const errors: string[] = []

    async function safe(type: string, fn: () => Promise<void>) {
      try {
        await fn()
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        logLine(`SAFE-CATCH ${type} msg=${JSON.stringify(msg)} ctor=${e === null ? 'null' : (e as object).constructor?.name}`)
        if (!/ENODATA|ENOTFOUND|SERVFAIL/i.test(msg)) errors.push(`${type}: ${msg}`)
      }
    }

    if (wanted.includes('A')) {
      await safe('A', async () => {
        const list = await dns.resolve4(host)
        for (const ip of list) records.push({ type: 'A', value: String(ip) })
      })
    }
    if (wanted.includes('AAAA')) {
      await safe('AAAA', async () => {
        const list = await dns.resolve6(host)
        for (const ip of list) records.push({ type: 'AAAA', value: String(ip) })
      })
    }
    if (wanted.includes('CNAME')) {
      await safe('CNAME', async () => {
        const list = await dns.resolveCname(host)
        for (const c of list) records.push({ type: 'CNAME', value: String(c) })
      })
    }
    if (wanted.includes('MX')) {
      await safe('MX', async () => {
        const list = await dns.resolveMx(host)
        for (const mx of list) records.push({ type: 'MX', value: `${String(mx.priority)} ${String(mx.exchange)}` })
      })
    }
    if (wanted.includes('TXT')) {
      await safe('TXT', async () => {
        const list = await dns.resolveTxt(host)
        for (const txt of list) records.push({ type: 'TXT', value: txt.join('') })
      })
    }
    if (wanted.includes('NS')) {
      await safe('NS', async () => {
        const list = await dns.resolveNs(host)
        for (const ns of list) records.push({ type: 'NS', value: String(ns) })
      })
    }

    if (!records.length && errors.length) {
      logLine(`RETURN errors-only ${JSON.stringify(errors)}`)
      return { success: false, error: errors.join('; ') }
    }
    if (!records.length) {
      logLine(`RETURN empty host=${host}`)
      return { success: false, error: `未查询到记录：${host}` }
    }
    logLine(`RETURN ok records=${records.length}`)
    return { success: true, data: { hostname: host, records } }
  } catch (e: unknown) {
    // 兜底：任何内部异常都转成可序列化的字符串返回，避免 Electron 报 “An object could not be cloned”
    const errStr = e instanceof Error ? e.message : String(e)
    logLine(`OUTER-CATCH ${JSON.stringify(errStr)} ctor=${e === null ? 'null' : (e as object).constructor?.name}`)
    return { success: false, error: `查询失败：${errStr}` }
  }
})

// ==================== 剪贴板历史 ====================

type ClipboardHistoryItem =
  | {
      id: string
      kind: 'text'
      text: string
      preview: string
      createdAt: number
    }
  | {
      id: string
      kind: 'image'
      fileName: string
      width: number
      height: number
      byteSize: number
      createdAt: number
    }

const CLIPBOARD_LIMIT = 40
let clipboardHistory: ClipboardHistoryItem[] = []
let clipboardWatchTimer: ReturnType<typeof setInterval> | null = null
let lastClipboardSig = ''

function getClipboardDir(): string {
  return join(app.getPath('userData'), 'clipboard')
}

function getClipboardHistoryPath(): string {
  return join(getClipboardDir(), 'history.json')
}

function clipboardImagePath(id: string): string {
  return join(getClipboardDir(), `${id}.png`)
}

async function ensureClipboardDir(): Promise<void> {
  await mkdir(getClipboardDir(), { recursive: true })
}

async function loadClipboardHistory(): Promise<void> {
  try {
    const raw = await readFile(getClipboardHistoryPath(), 'utf-8')
    const parsed = JSON.parse(raw) as ClipboardHistoryItem[]
    if (Array.isArray(parsed)) clipboardHistory = parsed.slice(0, CLIPBOARD_LIMIT)
  } catch {
    clipboardHistory = []
  }
}

async function saveClipboardHistory(): Promise<void> {
  await ensureClipboardDir()
  await writeFile(getClipboardHistoryPath(), JSON.stringify(clipboardHistory, null, 2), 'utf-8')
}

function notifyClipboardChanged(): void {
  mainWindow?.webContents.send('clipboard:changed', clipboardHistory)
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
}

async function pushClipboardItem(item: ClipboardHistoryItem): Promise<void> {
  clipboardHistory = [item, ...clipboardHistory.filter((x) => {
    if (item.kind === 'text' && x.kind === 'text') return x.text !== item.text
    return x.id !== item.id
  })].slice(0, CLIPBOARD_LIMIT)
  await saveClipboardHistory()
  notifyClipboardChanged()
}

async function pollClipboard(): Promise<void> {
  try {
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const png = image.toPNG()
      const sig = `img:${png.length}:${createHash('sha1').update(png).digest('hex')}`
      if (sig === lastClipboardSig) return
      lastClipboardSig = sig
      const id = makeId()
      await ensureClipboardDir()
      await writeFile(clipboardImagePath(id), png)
      const size = image.getSize()
      await pushClipboardItem({
        id,
        kind: 'image',
        fileName: `${id}.png`,
        width: size.width,
        height: size.height,
        byteSize: png.length,
        createdAt: Date.now()
      })
      return
    }

    const text = clipboard.readText()
    if (!text || !text.trim()) return
    const sig = `text:${createHash('sha1').update(text).digest('hex')}`
    if (sig === lastClipboardSig) return
    lastClipboardSig = sig
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text
    await pushClipboardItem({
      id: makeId(),
      kind: 'text',
      text,
      preview: preview.replace(/\s+/g, ' ').trim(),
      createdAt: Date.now()
    })
  } catch {
    // 忽略单次轮询失败
  }
}

function startClipboardWatch(): void {
  if (clipboardWatchTimer) return
  void pollClipboard()
  clipboardWatchTimer = setInterval(() => {
    void pollClipboard()
  }, 900)
}

function stopClipboardWatch(): void {
  if (clipboardWatchTimer) {
    clearInterval(clipboardWatchTimer)
    clipboardWatchTimer = null
  }
}

async function initClipboardHistory(): Promise<void> {
  await ensureClipboardDir()
  await loadClipboardHistory()
  startClipboardWatch()
}

ipcMain.handle('clipboard:list', async () => {
  return { success: true as const, data: clipboardHistory }
})

ipcMain.handle('clipboard:clear', async () => {
  for (const item of clipboardHistory) {
    if (item.kind === 'image') {
      try {
        await unlink(clipboardImagePath(item.id))
      } catch {
        /* ignore */
      }
    }
  }
  clipboardHistory = []
  lastClipboardSig = ''
  await saveClipboardHistory()
  notifyClipboardChanged()
  return { success: true as const }
})

ipcMain.handle('clipboard:remove', async (_event, id: string) => {
  const target = clipboardHistory.find((x) => x.id === id)
  clipboardHistory = clipboardHistory.filter((x) => x.id !== id)
  if (target?.kind === 'image') {
    try {
      await unlink(clipboardImagePath(id))
    } catch {
      /* ignore */
    }
  }
  await saveClipboardHistory()
  notifyClipboardChanged()
  return { success: true as const }
})

ipcMain.handle('clipboard:writeText', async (_event, text: string) => {
  clipboard.writeText(String(text ?? ''))
  lastClipboardSig = `text:${createHash('sha1').update(String(text ?? '')).digest('hex')}`
  return { success: true as const }
})

ipcMain.handle('clipboard:writeImage', async (_event, id: string) => {
  const file = clipboardImagePath(id)
  if (!existsSync(file)) return { success: false as const, error: '图片不存在' }
  const buf = await readFile(file)
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return { success: false as const, error: '无法读取图片' }
  clipboard.writeImage(img)
  lastClipboardSig = `img:${buf.length}:${createHash('sha1').update(buf).digest('hex')}`
  return { success: true as const }
})

ipcMain.handle('clipboard:getImageDataUrl', async (_event, id: string) => {
  const file = clipboardImagePath(id)
  if (!existsSync(file)) return { success: false as const, error: '图片不存在' }
  const buf = await readFile(file)
  return {
    success: true as const,
    dataUrl: `data:image/png;base64,${buf.toString('base64')}`
  }
})

function runPythonScript(scriptPath: string, args: string[]): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const python = spawn('python', [scriptPath, ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: stderr.trim()
      })
    })

    python.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message
      })
    })
  })
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function runFfmpegMp4ToWebp(
  inputPath: string,
  outputPath: string,
  options: {
    fps?: number
    maxWidth?: number
    quality?: number
    startSec?: number
    durationSec?: number
  }
): Promise<{ success: boolean; output: string; error: string }> {
  const fps = clampInt(options.fps, 1, 30, 12)
  const maxWidth = clampInt(options.maxWidth, 0, 3840, 640)
  const quality = clampInt(options.quality, 0, 100, 75)
  const startSec = typeof options.startSec === 'number' && options.startSec > 0 ? options.startSec : 0
  const durationSec = typeof options.durationSec === 'number' && options.durationSec > 0
    ? options.durationSec
    : 0

  const filters: string[] = [`fps=${fps}`]
  if (maxWidth > 0) {
    filters.push(`scale='min(${maxWidth},iw)':-1:flags=lanczos`)
  }

  const args: string[] = ['-y', '-hide_banner']
  if (startSec > 0) {
    args.push('-ss', String(startSec))
  }
  args.push('-i', inputPath)
  if (durationSec > 0) {
    args.push('-t', String(durationSec))
  }
  args.push(
    '-vf', filters.join(','),
    '-an',
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-q:v', String(quality),
    '-loop', '0',
    '-preset', 'default',
    outputPath
  )

  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() || '转换成功', error: '' })
        return
      }
      const errText = stderr.trim() || stdout.trim() || `ffmpeg 退出码 ${code}`
      resolve({ success: false, output: '', error: errText })
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message.includes('ENOENT')
          ? '未找到 ffmpeg，请安装并加入 PATH 后重启应用'
          : err.message
      })
    })
  })
}

function runFfmpeg(args: string[]): Promise<{ success: boolean; output: string; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() || '转换成功', error: '' })
        return
      }
      resolve({
        success: false,
        output: '',
        error: stderr.trim() || stdout.trim() || `ffmpeg 退出码 ${code}`
      })
    })
    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message.includes('ENOENT')
          ? '未找到 ffmpeg，请安装并加入 PATH 后重启应用'
          : err.message
      })
    })
  })
}

function runFfmpegTranscode(
  inputPath: string,
  outputPath: string,
  options: {
    mode: 'toMp3' | 'extractAudio' | 'compressVideo'
    audioBitrate?: string
    audioCodec?: 'mp3' | 'aac' | 'wav' | 'copy'
    videoCrf?: number
    maxWidth?: number
    startSec?: number
    durationSec?: number
  }
): Promise<{ success: boolean; output: string; error: string }> {
  const startSec = typeof options.startSec === 'number' && options.startSec > 0 ? options.startSec : 0
  const durationSec = typeof options.durationSec === 'number' && options.durationSec > 0
    ? options.durationSec
    : 0
  const bitrate = typeof options.audioBitrate === 'string' && options.audioBitrate
    ? options.audioBitrate
    : '192k'
  const crf = clampInt(options.videoCrf, 16, 40, 28)
  const maxWidth = clampInt(options.maxWidth, 0, 3840, 1280)
  const audioCodec = options.audioCodec || 'mp3'

  const args: string[] = ['-y', '-hide_banner']
  if (startSec > 0) args.push('-ss', String(startSec))
  args.push('-i', inputPath)
  if (durationSec > 0) args.push('-t', String(durationSec))

  if (options.mode === 'toMp3') {
    args.push('-vn', '-acodec', 'libmp3lame', '-b:a', bitrate, outputPath)
  } else if (options.mode === 'extractAudio') {
    args.push('-vn')
    if (audioCodec === 'copy') {
      args.push('-acodec', 'copy', outputPath)
    } else if (audioCodec === 'wav') {
      args.push('-acodec', 'pcm_s16le', outputPath)
    } else if (audioCodec === 'aac') {
      args.push('-acodec', 'aac', '-b:a', bitrate, outputPath)
    } else {
      args.push('-acodec', 'libmp3lame', '-b:a', bitrate, outputPath)
    }
  } else {
    const filters: string[] = []
    if (maxWidth > 0) filters.push(`scale='min(${maxWidth},iw)':-2:flags=lanczos`)
    if (filters.length) args.push('-vf', filters.join(','))
    args.push(
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', String(crf),
      '-c:a', 'aac',
      '-b:a', bitrate,
      '-movflags', '+faststart',
      outputPath
    )
  }

  return runFfmpeg(args)
}
