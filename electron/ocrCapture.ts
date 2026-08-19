import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  type Display,
  type NativeImage
} from 'electron'
import { join } from 'path'

/** 截图 OCR 的选区结果：裁剪后的 PNG base64 + 原始截图像素尺寸 */
export interface OcrCaptureResult {
  success: boolean
  /** data:image/png;base64, 前缀的选区图 */
  dataUrl?: string
  width?: number
  height?: number
  cancelled?: boolean
  error?: string
}

interface OverlayPayload {
  dataUrl: string
  /** 物理像素 / CSS 像素，用于把鼠标坐标映射到截图像素 */
  scaleX: number
  scaleY: number
}

interface Region {
  x: number
  y: number
  width: number
  height: number
}

let capturing = false
let overlayWindows: BrowserWindow[] = []
let resolveCapture: ((result: OcrCaptureResult) => void) | null = null
let currentThumbnails: { display: Display; image: NativeImage }[] = []

function buildOverlayHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  html, body {
    margin: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    cursor: crosshair;
    background: #000;
    user-select: none;
  }
  #shot {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: auto;
    z-index: 1;
  }
  #mask {
    position: fixed;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }
  #hud {
    position: fixed;
    left: 16px;
    top: 16px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(20, 20, 24, 0.92);
    color: #fff;
    font: 12px/1.4 system-ui, sans-serif;
    z-index: 4;
    pointer-events: none;
    box-shadow: 0 6px 20px rgba(0,0,0,.3);
    white-space: pre;
  }
  #confirm-hint {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    padding: 10px 16px;
    border-radius: 999px;
    background: rgba(20, 20, 24, 0.88);
    color: #f5f5f5;
    font: 13px/1.2 system-ui, sans-serif;
    pointer-events: none;
    z-index: 4;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <img id="shot" alt="" />
  <canvas id="mask"></canvas>
  <div id="hud"></div>
  <div id="confirm-hint">拖动划选区域 · 松开确认 · Esc / 右键取消</div>
  <script>
    const shot = document.getElementById('shot')
    const mask = document.getElementById('mask')
    const ctx = mask.getContext('2d')
    const hud = document.getElementById('hud')
    let scaleX = 1
    let scaleY = 1
    let ready = false
    let start = null
    let currentRect = null

    function clampRect(x, y, w, h) {
      const minX = Math.max(0, Math.min(x, window.innerWidth))
      const minY = Math.max(0, Math.min(y, window.innerHeight))
      const maxX = Math.max(0, Math.min(x + w, window.innerWidth))
      const maxY = Math.max(0, Math.min(y + h, window.innerHeight))
      if (maxX <= minX || maxY <= minY) return null
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function drawMask() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      if (!currentRect) return
      // 选区外透明框：用 destination-out 挖空选区，再画描边
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,1)'
      ctx.fillRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height)
      ctx.restore()
      ctx.strokeStyle = '#ff7eb6'
      ctx.lineWidth = 2
      ctx.strokeRect(
        currentRect.x + 1, currentRect.y + 1,
        currentRect.width - 2, currentRect.height - 2
      )
      // 四角尺寸标记
      hud.textContent =
        '选区: ' + Math.round(currentRect.width) + ' × ' + Math.round(currentRect.height) + ' px'
    }

    function resizeMask() {
      mask.width = window.innerWidth * devicePixelRatio
      mask.height = window.innerHeight * devicePixelRatio
      mask.style.width = window.innerWidth + 'px'
      mask.style.height = window.innerHeight + 'px'
      ctx.scale(devicePixelRatio, devicePixelRatio)
    }

    window.ocrCaptureOverlay.onInit((payload) => {
      scaleX = payload.scaleX || 1
      scaleY = payload.scaleY || 1
      // 关键：必须把截图赋给 <img id="shot">，否则覆盖层只有黑色背景
      shot.src = payload.dataUrl
      const img = new Image()
      img.onload = () => {
        shot.style.width = window.innerWidth + 'px'
        shot.style.height = window.innerHeight + 'px'
        // 以实际图片与窗口尺寸校准映射，避免 DPI/缩放偏差
        scaleX = img.naturalWidth / Math.max(1, window.innerWidth)
        scaleY = img.naturalHeight / Math.max(1, window.innerHeight)
        ready = true
        resizeMask()
        drawMask()
      }
      img.src = payload.dataUrl
    })

    window.addEventListener('mousedown', (e) => {
      if (!ready) return
      e.preventDefault()
      start = { x: e.clientX, y: e.clientY }
      currentRect = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
      drawMask()
    })

    window.addEventListener('mousemove', (e) => {
      if (!ready || !start) return
      currentRect = clampRect(start.x, start.y, e.clientX - start.x, e.clientY - start.y)
      drawMask()
    })

    window.addEventListener('mouseup', (e) => {
      if (!ready || !start) return
      e.preventDefault()
      const rect = clampRect(start.x, start.y, e.clientX - start.x, e.clientY - start.y)
      start = null
      if (!rect || rect.width < 3 || rect.height < 3) {
        currentRect = null
        drawMask()
        return
      }
      // 映射到截图物理像素
      window.ocrCaptureOverlay.confirm({
        x: Math.round(rect.x * scaleX),
        y: Math.round(rect.y * scaleY),
        width: Math.round(rect.width * scaleX),
        height: Math.round(rect.height * scaleY)
      })
    })

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        window.ocrCaptureOverlay.cancel()
      }
    })

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.ocrCaptureOverlay.cancel()
    })
  </script>
</body>
</html>`
}

function cleanupOverlays() {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  overlayWindows = []
  currentThumbnails = []
}

function finishCapture(result: OcrCaptureResult) {
  cleanupOverlays()
  capturing = false
  const resolve = resolveCapture
  resolveCapture = null
  resolve?.(result)
}

/**
 * 一次截取全部显示器。thumbnailSize 取各屏物理像素尺寸，
 * 再按 display_id / 尺寸匹配，并 resize 到该屏真实物理尺寸以保证选区精度。
 *
 * 注意：display.size 已是物理像素（bounds × scaleFactor 的乘积）。
 * 不要再用 size × scaleFactor 二次放大——Windows 上 desktopCapturer
 * 对超过屏幕分辨率的 thumbnailSize 会返回黑图。
 */
async function captureAllDisplays(displays: Display[]): Promise<OverlayPayload[]> {
  const targets = displays.map((d) => ({
    display: d,
    thumbWidth: Math.max(1, Math.round(d.size.width)),
    thumbHeight: Math.max(1, Math.round(d.size.height))
  }))

  const maxW = Math.max(...targets.map((t) => t.thumbWidth))
  const maxH = Math.max(...targets.map((t) => t.thumbHeight))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH }
  })

  if (!sources.length) {
    throw new Error('无法截取屏幕画面，请检查屏幕录制权限')
  }

  const used = new Set<string>()
  currentThumbnails = []

  return targets.map(({ display, thumbWidth, thumbHeight }) => {
    let matched =
      sources.find((s) => s.display_id === String(display.id) && !used.has(s.id)) ||
      sources.find((s) => {
        if (used.has(s.id)) return false
        const size = s.thumbnail.getSize()
        return size.width === thumbWidth && size.height === thumbHeight
      }) ||
      sources.find((s) => !used.has(s.id))

    if (!matched || matched.thumbnail.isEmpty()) {
      throw new Error(`无法截取显示器画面（id=${display.id}）`)
    }
    used.add(matched.id)

    let image = matched.thumbnail
    const size = image.getSize()
    if (size.width !== thumbWidth || size.height !== thumbHeight) {
      image = image.resize({ width: thumbWidth, height: thumbHeight, quality: 'best' })
    }

    const bounds = display.bounds
    currentThumbnails.push({ display, image })
    return {
      dataUrl: image.toDataURL(),
      scaleX: thumbWidth / Math.max(1, bounds.width),
      scaleY: thumbHeight / Math.max(1, bounds.height)
    }
  })
}

/** 从对应的屏幕截图里裁剪选区，返回 base64 PNG。index 为用户操作所在显示器的下标 */
function cropRegion(region: Region, index: number): { dataUrl: string; width: number; height: number } {
  const target = currentThumbnails[index]
  const image = target?.image ?? currentThumbnails[0]?.image
  if (!image) throw new Error('截图数据丢失，请重试')

  const cropped = image.crop({
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height
  })
  if (cropped.isEmpty()) throw new Error('选区裁剪失败')
  const size = cropped.getSize()
  return { dataUrl: cropped.toDataURL(), width: size.width, height: size.height }
}

function createOverlayWindow(display: Display, payload: OverlayPayload, preloadPath: string): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml())}`)

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('ocr-capture:init', payload)
    win.show()
    win.focus()
  })

  return win
}

/**
 * 系统级截图选区：最小化主窗口 → 截取各显示器 → 全屏覆盖层拖动划选。
 * 返回选区裁剪后的 PNG base64。
 */
export async function startOcrCapture(mainWindow: BrowserWindow | null): Promise<OcrCaptureResult> {
  if (capturing) {
    return { success: false, error: '已有截图会话进行中' }
  }

  capturing = true

  const wasMinimized = mainWindow?.isMinimized() ?? false
  const wasVisible = mainWindow?.isVisible() ?? false

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize()
      // 等最小化动画完成，避免截到本应用窗口
      await new Promise((r) => setTimeout(r, 200))
    }

    const displays = screen.getAllDisplays()
    const preloadPath = join(__dirname, 'ocrCapturePreload.js')
    const payloads = await captureAllDisplays(displays)

    const result = await new Promise<OcrCaptureResult>((resolve) => {
      resolveCapture = resolve

      const onConfirm = (_event: Electron.IpcMainEvent, region: Region) => {
        teardownListeners()
        try {
          // 通过 event.sender 反查用户操作的是哪个覆盖层窗口（显示器）
          const winIndex = overlayWindows.findIndex((w) => !w.isDestroyed() && w.webContents === _event.sender)
          const cropped = cropRegion(region, winIndex)
          finishCapture({ ...cropped, success: true })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          finishCapture({ success: false, error: message })
        }
      }
      const onCancel = () => {
        teardownListeners()
        finishCapture({ success: false, cancelled: true })
      }
      const teardownListeners = () => {
        ipcMain.removeListener('ocr-capture:confirm', onConfirm)
        ipcMain.removeListener('ocr-capture:cancel', onCancel)
      }

      ipcMain.on('ocr-capture:confirm', onConfirm)
      ipcMain.on('ocr-capture:cancel', onCancel)

      overlayWindows = displays.map((display, i) =>
        createOverlayWindow(display, payloads[i], preloadPath)
      )
    })

    return result
  } catch (err: unknown) {
    cleanupOverlays()
    capturing = false
    resolveCapture = null
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!wasMinimized && wasVisible) {
        mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      } else if (!wasMinimized) {
        mainWindow.show()
      }
    }
  }
}