import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  type Display
} from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** 粉色魔法棒光标（32×32），热点在星芒尖端附近 */
function getWandCursorDataUrl(): string {
  const candidates = [
    join(__dirname, 'assets', 'magic-wand-cursor-32.png'),
    join(process.cwd(), 'electron', 'assets', 'magic-wand-cursor-32.png'),
    join(process.cwd(), 'dist-electron', 'assets', 'magic-wand-cursor-32.png')
  ]
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      return `data:image/png;base64,${readFileSync(filePath).toString('base64')}`
    }
  }
  return ''
}

export interface ColorPickResult {
  success: boolean
  hex?: string
  cancelled?: boolean
  error?: string
}

interface OverlayPayload {
  dataUrl: string
  /** 物理像素 / CSS 像素，用于把鼠标坐标映射到截图像素 */
  scaleX: number
  scaleY: number
}

let picking = false
let overlayWindows: BrowserWindow[] = []
let resolvePick: ((result: ColorPickResult) => void) | null = null

function buildOverlayHtml(): string {
  const wandCursor = getWandCursorDataUrl()
  // 热点约在星芒中心（左上），取色对准该点；失败时回退十字光标
  const cursorCss = wandCursor
    ? `url('${wandCursor}') 5 5, crosshair`
    : 'crosshair'

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
    cursor: ${cursorCss};
    background: #000;
    user-select: none;
  }
  #shot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }
  #lens {
    position: fixed;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.35);
    pointer-events: none;
    overflow: hidden;
    display: none;
    z-index: 2;
    background: #111;
  }
  #lens canvas {
    position: absolute;
    left: 0;
    top: 0;
    image-rendering: pixelated;
  }
  #cross {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.5);
    z-index: 3;
    pointer-events: none;
  }
  #hud {
    position: fixed;
    left: 0;
    top: 0;
    transform: translate(16px, 16px);
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(20, 20, 24, 0.92);
    color: #fff;
    font: 12px/1.2 Consolas, "Courier New", monospace;
    pointer-events: none;
    z-index: 4;
    box-shadow: 0 6px 20px rgba(0,0,0,.3);
  }
  #swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,.7);
  }
  #hint {
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
  }
</style>
</head>
<body>
  <canvas id="shot"></canvas>
  <div id="lens"><canvas></canvas><div id="cross"></div></div>
  <div id="hud"><div id="swatch"></div><span id="hex">#000000</span></div>
  <div id="hint">点击取色 · Esc / 右键取消</div>
  <script>
    const shot = document.getElementById('shot')
    const shotCtx = shot.getContext('2d', { willReadFrequently: true })
    const lens = document.getElementById('lens')
    const lensCanvas = lens.querySelector('canvas')
    const lensCtx = lensCanvas.getContext('2d')
    const hud = document.getElementById('hud')
    const swatch = document.getElementById('swatch')
    const hexEl = document.getElementById('hex')
    const ZOOM = 8
    const LENS = 120
    lensCanvas.width = LENS
    lensCanvas.height = LENS
    let scaleX = 1
    let scaleY = 1
    let ready = false

    function sample(clientX, clientY) {
      const x = Math.min(shot.width - 1, Math.max(0, Math.floor(clientX * scaleX)))
      const y = Math.min(shot.height - 1, Math.max(0, Math.floor(clientY * scaleY)))
      const data = shotCtx.getImageData(x, y, 1, 1).data
      const hex = '#' + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
      return { x, y, hex }
    }

    function paintLens(x, y, clientX, clientY) {
      lens.style.display = 'block'
      hud.style.display = 'flex'
      const half = LENS / (2 * ZOOM)
      lensCtx.imageSmoothingEnabled = false
      lensCtx.clearRect(0, 0, LENS, LENS)
      lensCtx.drawImage(shot, x - half, y - half, half * 2, half * 2, 0, 0, LENS, LENS)
      const offset = 18
      let left = clientX + offset
      let top = clientY + offset
      if (left + LENS + 8 > window.innerWidth) left = clientX - LENS - offset
      if (top + LENS + 40 > window.innerHeight) top = clientY - LENS - offset
      lens.style.left = left + 'px'
      lens.style.top = top + 'px'
      hud.style.transform = 'translate(' + left + 'px,' + (top + LENS + 8) + 'px)'
    }

    window.colorPickerOverlay.onInit((payload) => {
      scaleX = payload.scaleX || 1
      scaleY = payload.scaleY || 1
      const img = new Image()
      img.onload = () => {
        shot.width = img.width
        shot.height = img.height
        shot.style.width = window.innerWidth + 'px'
        shot.style.height = window.innerHeight + 'px'
        shotCtx.drawImage(img, 0, 0)
        // 以实际画布与窗口尺寸再校准一次，避免 DPI/缩放偏差
        scaleX = shot.width / Math.max(1, window.innerWidth)
        scaleY = shot.height / Math.max(1, window.innerHeight)
        ready = true
      }
      img.src = payload.dataUrl
    })

    window.addEventListener('mousemove', (e) => {
      if (!ready) return
      const { x, y, hex } = sample(e.clientX, e.clientY)
      swatch.style.background = hex
      hexEl.textContent = hex
      paintLens(x, y, e.clientX, e.clientY)
    })

    window.addEventListener('click', (e) => {
      if (!ready) return
      e.preventDefault()
      const { hex } = sample(e.clientX, e.clientY)
      window.colorPickerOverlay.pick(hex)
    })

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        window.colorPickerOverlay.cancel()
      }
    })

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      window.colorPickerOverlay.cancel()
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
}

function finishPick(result: ColorPickResult) {
  cleanupOverlays()
  picking = false
  const resolve = resolvePick
  resolvePick = null
  resolve?.(result)
}

/**
 * 一次截取全部显示器。thumbnailSize 取各屏物理像素最大值，
 * 再按 display_id / 尺寸匹配，并 resize 到该屏真实物理尺寸以保证取色精度。
 */
async function captureAllDisplays(displays: Display[]): Promise<OverlayPayload[]> {
  const targets = displays.map((d) => ({
    display: d,
    thumbWidth: Math.max(1, Math.round(d.size.width * (d.scaleFactor || 1))),
    thumbHeight: Math.max(1, Math.round(d.size.height * (d.scaleFactor || 1)))
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
    return {
      dataUrl: image.toDataURL(),
      scaleX: thumbWidth / Math.max(1, bounds.width),
      scaleY: thumbHeight / Math.max(1, bounds.height)
    }
  })
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
    backgroundColor: '#000000',
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
    win.webContents.send('color-picker:init', payload)
    win.show()
    win.focus()
  })

  return win
}

/**
 * 系统级取色：最小化主窗口 → 截取各显示器 → 全屏覆盖层点击取色。
 * 覆盖层基于真实桌面截图，可取任意 Windows 窗口上的颜色。
 */
export async function startSystemColorPick(mainWindow: BrowserWindow | null): Promise<ColorPickResult> {
  if (picking) {
    return { success: false, error: '已有取色会话进行中' }
  }

  picking = true

  const wasMinimized = mainWindow?.isMinimized() ?? false
  const wasVisible = mainWindow?.isVisible() ?? false

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize()
      // 等最小化动画完成，避免截到本应用窗口
      await new Promise((r) => setTimeout(r, 200))
    }

    const displays = screen.getAllDisplays()
    const preloadPath = join(__dirname, 'colorPickerPreload.js')
    const payloads = await captureAllDisplays(displays)

    const result = await new Promise<ColorPickResult>((resolve) => {
      resolvePick = resolve

      const onPicked = (_event: Electron.IpcMainEvent, hex: string) => {
        teardownListeners()
        finishPick({ success: true, hex: toHexFromString(hex) })
      }
      const onCancel = () => {
        teardownListeners()
        finishPick({ success: false, cancelled: true })
      }
      const teardownListeners = () => {
        ipcMain.removeListener('color-picker:picked', onPicked)
        ipcMain.removeListener('color-picker:cancel', onCancel)
      }

      ipcMain.on('color-picker:picked', onPicked)
      ipcMain.on('color-picker:cancel', onCancel)

      overlayWindows = displays.map((display, i) =>
        createOverlayWindow(display, payloads[i], preloadPath)
      )
    })

    return result
  } catch (err: unknown) {
    cleanupOverlays()
    picking = false
    resolvePick = null
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

function toHexFromString(hex: string): string {
  const raw = hex.replace('#', '').toUpperCase()
  if (/^[0-9A-F]{6}$/.test(raw)) return `#${raw}`
  if (/^[0-9A-F]{3}$/.test(raw)) {
    return `#${raw.split('').map((c) => c + c).join('')}`
  }
  return hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`
}
