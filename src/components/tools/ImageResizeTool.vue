<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

interface ImageItem {
  id: string
  name: string
  sourcePath?: string
  sourceUrl: string
  width: number
  height: number
  size: number
  outUrl: string
  outSize: number
  outWidth: number
  outHeight: number
  outFormat: 'jpeg' | 'png' | 'webp'
  animated: boolean
  outAnimated: boolean
  crop?: CropRect
}

const items = ref<ImageItem[]>([])
const maxWidth = ref(1920)
const quality = ref(0.8)
const format = ref<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg')
const keepAspect = ref(true)
const msg = ref('')
const busy = ref(false)
const cropItem = ref<ImageItem | null>(null)
const icoBusyId = ref('')
const cropDraft = ref<CropRect>({ x: 0, y: 0, width: 1, height: 1 })
const cropRatio = ref<'free' | '1:1' | '4:3' | '3:4' | '16:9'>('free')

const CROP_MAX_WIDTH = 760
const CROP_MAX_HEIGHT = 500
const MIN_CROP_PX = 32

const cropDisplay = computed(() => {
  const item = cropItem.value
  if (!item) return { width: 1, height: 1 }
  const scale = Math.min(CROP_MAX_WIDTH / item.width, CROP_MAX_HEIGHT / item.height, 1)
  return {
    width: Math.max(1, Math.round(item.width * scale)),
    height: Math.max(1, Math.round(item.height * scale))
  }
})

const cropBoxStyle = computed(() => ({
  left: `${cropDraft.value.x * cropDisplay.value.width}px`,
  top: `${cropDraft.value.y * cropDisplay.value.height}px`,
  width: `${cropDraft.value.width * cropDisplay.value.width}px`,
  height: `${cropDraft.value.height * cropDisplay.value.height}px`
}))

let drag:
  | {
      mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
      startX: number
      startY: number
      start: CropRect
    }
  | null = null

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function loadFromPath(filePath: string, name: string) {
  const result = await window.electronAPI.file.readBinary(filePath)
  if (!result.success || !result.base64) throw new Error(result.error || '读取失败')
  const ext = name.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  const url = `data:${mime};base64,${result.base64}`
  let metadata:
    | { width: number; height: number; animated: boolean; format: string }
    | undefined
  const metaResult = await window.electronAPI.image.metadata(filePath)
  if (metaResult.success) metadata = metaResult.data
  await pushImage(url, name, filePath, result.size ?? 0, metadata)
}

async function pushImage(
  url: string,
  name: string,
  sourcePath: string | undefined,
  sizeHint: number,
  metadata?: { width: number; height: number; animated: boolean; format: string }
) {
  const img = await loadImage(url)
  const size = sizeHint || Math.round((url.length * 3) / 4)
  items.value.push({
    id: uid(),
    name,
    sourcePath,
    sourceUrl: url,
    width: metadata?.width || img.naturalWidth,
    height: metadata?.height || img.naturalHeight,
    size,
    outUrl: '',
    outSize: 0,
    outWidth: 0,
    outHeight: 0,
    outFormat: 'jpeg',
    animated: metadata?.animated || false,
    outAnimated: false
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

async function pickFiles() {
  msg.value = ''
  // 主进程 openFile 目前是单选；多次选择靠循环体验不好，先支持单选+拖拽多文件
  const path = await window.electronAPI.dialog.openFile({
    title: '选择图片',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
  })
  if (!path) return
  const name = path.split(/[/\\]/).pop() || 'image.jpg'
  try {
    await loadFromPath(path, name)
  } catch (e: unknown) {
    msg.value = e instanceof Error ? e.message : String(e)
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files || [])
  void addDroppedFiles(files)
}

async function addDroppedFiles(files: File[]) {
  msg.value = ''
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const withPath = file as File & { path?: string }
    try {
      if (withPath.path) {
        await loadFromPath(withPath.path, file.name)
      } else {
        const url = URL.createObjectURL(file)
        await pushImage(url, file.name, undefined, file.size)
      }
    } catch (err: unknown) {
      msg.value = err instanceof Error ? err.message : String(err)
    }
  }
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  void addDroppedFiles(files)
  input.value = ''
}

function calcTargetSize(w: number, h: number): { tw: number; th: number } {
  if (!keepAspect.value || w <= maxWidth.value) {
    return { tw: Math.min(w, maxWidth.value), th: keepAspect.value ? Math.round((h * Math.min(w, maxWidth.value)) / w) : h }
  }
  const tw = maxWidth.value
  const th = Math.max(1, Math.round((h * tw) / w))
  return { tw, th }
}

async function processOne(item: ImageItem): Promise<void> {
  if (item.sourcePath) {
    const crop = item.crop
      ? {
          x: item.crop.x * item.width,
          y: item.crop.y * item.height,
          width: item.crop.width * item.width,
          height: item.crop.height * item.height
        }
      : undefined
    const result = await window.electronAPI.image.cropResize(item.sourcePath, {
      crop,
      maxWidth: maxWidth.value,
      quality: Math.round(quality.value * 100),
      format: mimeToFormat(format.value)
    })
    if (!result.success) throw new Error(result.error)
    const mime = `image/${result.data.format}`
    item.outUrl = `data:${mime};base64,${result.data.base64}`
    item.outSize = result.data.byteSize
    item.outWidth = result.data.width
    item.outHeight = result.data.height
    item.outFormat = result.data.format
    item.outAnimated = result.data.animated
    return
  }

  const img = await loadImage(item.sourceUrl)
  const crop = item.crop || { x: 0, y: 0, width: 1, height: 1 }
  const sx = Math.round(crop.x * img.naturalWidth)
  const sy = Math.round(crop.y * img.naturalHeight)
  const sw = Math.max(1, Math.round(crop.width * img.naturalWidth))
  const sh = Math.max(1, Math.round(crop.height * img.naturalHeight))
  const { tw, th } = calcTargetSize(sw, sh)
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th)
  const outUrl = canvas.toDataURL(format.value, quality.value)
  const base64 = outUrl.split(',')[1] || ''
  item.outUrl = outUrl
  item.outSize = Math.round((base64.length * 3) / 4)
  item.outWidth = tw
  item.outHeight = th
  item.outFormat = mimeToFormat(format.value)
  item.outAnimated = false
}

async function processAll() {
  if (!items.value.length) return
  busy.value = true
  msg.value = ''
  try {
    for (const item of items.value) {
      await processOne(item)
    }
    msg.value = `已处理 ${items.value.length} 张`
  } catch (e: unknown) {
    msg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function mimeToFormat(mime: string): 'jpeg' | 'png' | 'webp' {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpeg'
}

function extForItem(item: ImageItem): string {
  return item.outFormat === 'jpeg' ? 'jpg' : item.outFormat
}

async function saveOne(item: ImageItem) {
  if (!item.outUrl) return
  const base = item.name.replace(/\.[^.]+$/, '')
  const path = await window.electronAPI.dialog.saveFile({
    title: '保存图片',
    defaultPath: `${base}-compressed.${extForItem(item)}`,
    filters: [{ name: '图片', extensions: [extForItem(item)] }]
  })
  if (!path) return
  const base64 = item.outUrl.replace(/^data:[^;]+;base64,/, '')
  const result = await window.electronAPI.file.writeBase64(path, base64)
  if (!result.success) msg.value = result.error || '保存失败'
}

async function saveAll() {
  const dir = await window.electronAPI.dialog.openDirectory('选择输出目录')
  if (!dir) return
  let ok = 0
  for (const item of items.value) {
    if (!item.outUrl) continue
    const base = item.name.replace(/\.[^.]+$/, '')
    const path = `${dir}\\${base}-compressed.${extForItem(item)}`
    const base64 = item.outUrl.replace(/^data:[^;]+;base64,/, '')
    const result = await window.electronAPI.file.writeBase64(path, base64)
    if (result.success) ok++
  }
  msg.value = `已保存 ${ok} 张到 ${dir}`
}

function removeItem(id: string) {
  items.value = items.value.filter((i) => i.id !== id)
}

async function toIco(item: ImageItem) {
  if (!item.sourcePath) {
    msg.value = '仅支持本地文件转 ICO（拖拽/上传的无路径文件暂不支持）'
    return
  }
  icoBusyId.value = item.id
  msg.value = ''
  try {
    const result = await window.electronAPI.image.toIco(item.sourcePath)
    if (!result.success) throw new Error(result.error || '转换失败')
    const base = item.name.replace(/\.[^.]+$/, '')
    const path = await window.electronAPI.dialog.saveFile({
      title: '保存 ICO 图标',
      defaultPath: `${base}.ico`,
      filters: [{ name: 'ICO 图标', extensions: ['ico'] }]
    })
    if (!path) return
    const saved = await window.electronAPI.file.writeBase64(path, result.base64)
    if (!saved.success) msg.value = saved.error || '保存失败'
    else msg.value = `已保存 ICO：${path}`
  } catch (e: unknown) {
    msg.value = e instanceof Error ? e.message : String(e)
  } finally {
    icoBusyId.value = ''
  }
}

function clearAll() {
  items.value = []
  msg.value = ''
}

function openCrop(item: ImageItem) {
  cropItem.value = item
  cropDraft.value = item.crop
    ? { ...item.crop }
    : { x: 0, y: 0, width: 1, height: 1 }
  cropRatio.value = 'free'
}

function closeCrop() {
  cropItem.value = null
  drag = null
}

function resetCrop() {
  cropDraft.value = { x: 0, y: 0, width: 1, height: 1 }
  cropRatio.value = 'free'
}

function applyCrop() {
  const item = cropItem.value
  if (!item) return
  item.crop = { ...cropDraft.value }
  item.outUrl = ''
  item.outSize = 0
  item.outAnimated = false
  closeCrop()
}

function ratioValue(): number | null {
  if (cropRatio.value === 'free') return null
  const [w, h] = cropRatio.value.split(':').map(Number)
  return w / h
}

function setCropRatio(value: typeof cropRatio.value) {
  cropRatio.value = value
  const ratio = ratioValue()
  if (!ratio) return
  const item = cropItem.value
  if (!item) return
  const displayRatio = ratio * (item.height / item.width)
  let width = cropDraft.value.width
  let height = width / displayRatio
  if (height > cropDraft.value.height) {
    height = cropDraft.value.height
    width = height * displayRatio
  }
  const cx = cropDraft.value.x + cropDraft.value.width / 2
  const cy = cropDraft.value.y + cropDraft.value.height / 2
  cropDraft.value = {
    x: Math.max(0, Math.min(1 - width, cx - width / 2)),
    y: Math.max(0, Math.min(1 - height, cy - height / 2)),
    width,
    height
  }
}

function beginCropDrag(
  event: PointerEvent,
  mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
) {
  event.preventDefault()
  event.stopPropagation()
  drag = {
    mode,
    startX: event.clientX,
    startY: event.clientY,
    start: { ...cropDraft.value }
  }
  window.addEventListener('pointermove', onCropPointerMove)
  window.addEventListener('pointerup', endCropDrag, { once: true })
}

function onCropPointerMove(event: PointerEvent) {
  if (!drag) return
  const dx = (event.clientX - drag.startX) / cropDisplay.value.width
  const dy = (event.clientY - drag.startY) / cropDisplay.value.height
  const s = drag.start
  if (drag.mode === 'move') {
    cropDraft.value = {
      ...s,
      x: Math.max(0, Math.min(1 - s.width, s.x + dx)),
      y: Math.max(0, Math.min(1 - s.height, s.y + dy))
    }
    return
  }

  const east = drag.mode === 'ne' || drag.mode === 'se'
  const south = drag.mode === 'sw' || drag.mode === 'se'
  const anchorX = east ? s.x : s.x + s.width
  const anchorY = south ? s.y : s.y + s.height
  const pointerX = east ? s.x + s.width + dx : s.x + dx
  const pointerY = south ? s.y + s.height + dy : s.y + dy
  const maxWidth = east ? 1 - anchorX : anchorX
  const maxHeight = south ? 1 - anchorY : anchorY
  const minWidth = MIN_CROP_PX / cropDisplay.value.width
  const minHeight = MIN_CROP_PX / cropDisplay.value.height
  let width = Math.max(minWidth, Math.min(maxWidth, Math.abs(pointerX - anchorX)))
  let height = Math.max(minHeight, Math.min(maxHeight, Math.abs(pointerY - anchorY)))
  const naturalRatio = ratioValue()

  if (naturalRatio && cropItem.value) {
    const displayRatio = naturalRatio * (cropItem.value.height / cropItem.value.width)
    if (width / height > displayRatio) width = height * displayRatio
    else height = width / displayRatio
    if (width > maxWidth) {
      width = maxWidth
      height = width / displayRatio
    }
    if (height > maxHeight) {
      height = maxHeight
      width = height * displayRatio
    }
  }

  cropDraft.value = {
    x: east ? anchorX : anchorX - width,
    y: south ? anchorY : anchorY - height,
    width,
    height
  }
}

function endCropDrag() {
  drag = null
  window.removeEventListener('pointermove', onCropPointerMove)
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onCropPointerMove)
})
</script>

<template>
  <div
    class="tool-card"
    @dragover.prevent
    @drop="onDrop"
  >
    <div class="head">
      <h2>图片压缩 / 裁剪 / 改尺寸</h2>
      <p>拖动裁剪框四角自由裁剪；动图 WebP 会逐帧处理并保留动画</p>
    </div>

    <div class="toolbar">
      <button type="button" class="btn btn-primary" @click="pickFiles">选择图片</button>
      <label class="btn file-btn">
        多选上传
        <input type="file" accept="image/*" multiple hidden @change="onFileInput" />
      </label>
      <label class="inline">
        最大宽
        <input v-model.number="maxWidth" class="num" type="number" min="64" max="8192" step="16" />
      </label>
      <label class="inline">
        质量
        <input v-model.number="quality" class="num" type="number" min="0.1" max="1" step="0.05" />
      </label>
      <label class="inline">
        格式
        <select v-model="format" class="select">
          <option value="image/jpeg">JPEG</option>
          <option value="image/png">PNG</option>
          <option value="image/webp">WebP</option>
        </select>
      </label>
      <label class="flag">
        <input v-model="keepAspect" type="checkbox" />
        缩放保持比例
      </label>
      <button type="button" class="btn btn-primary" :disabled="busy || !items.length" @click="processAll">
        {{ busy ? '处理中…' : '开始处理' }}
      </button>
      <button type="button" class="btn" :disabled="!items.some((i) => i.outUrl)" @click="saveAll">全部保存</button>
      <button type="button" class="btn" @click="clearAll">清空</button>
    </div>

    <div v-if="msg" class="msg">{{ msg }}</div>
    <div v-if="!items.length" class="empty">拖拽图片到此处，或点击上方选择</div>

    <div class="list">
      <div v-for="item in items" :key="item.id" class="item">
        <img class="thumb" :src="item.outUrl || item.sourceUrl" alt="" />
        <div class="meta">
          <div class="name">{{ item.name }}</div>
          <div class="info">
            原图 {{ item.width }}×{{ item.height }} · {{ fmtSize(item.size) }}
            <span v-if="item.animated" class="animated-tag">动图 WebP</span>
          </div>
          <div v-if="item.crop" class="info crop-info">
            裁剪区域
            {{ Math.round(item.crop.width * item.width) }}×{{ Math.round(item.crop.height * item.height) }}
          </div>
          <div v-if="item.outUrl" class="info ok">
            输出 {{ item.outWidth }}×{{ item.outHeight }} · {{ fmtSize(item.outSize) }}
            <span v-if="item.size">
              （{{ Math.round((item.outSize / item.size) * 100) }}%）
            </span>
            <span v-if="item.outAnimated"> · 保留动画</span>
          </div>
        </div>
        <div class="actions">
          <button type="button" class="btn" @click="openCrop(item)">裁剪</button>
          <button
            type="button"
            class="btn"
            :disabled="!item.sourcePath || icoBusyId === item.id"
            @click="toIco(item)"
          >
            {{ icoBusyId === item.id ? '转换中…' : '转ICO' }}
          </button>
          <button type="button" class="btn" :disabled="!item.outUrl" @click="saveOne(item)">保存</button>
          <button type="button" class="btn" @click="removeItem(item.id)">移除</button>
        </div>
      </div>
    </div>

    <div v-if="cropItem" class="crop-mask" @click.self="closeCrop">
      <div class="crop-dialog">
        <div class="crop-head">
          <div>
            <h3>裁剪：{{ cropItem.name }}</h3>
            <p>拖动四个角调整尺寸，拖动框内区域移动位置</p>
          </div>
          <button type="button" class="close-btn" @click="closeCrop">×</button>
        </div>

        <div class="ratio-row">
          <span>比例</span>
          <button
            v-for="ratio in (['free', '1:1', '4:3', '3:4', '16:9'] as const)"
            :key="ratio"
            type="button"
            class="ratio-btn"
            :class="{ active: cropRatio === ratio }"
            @click="setCropRatio(ratio)"
          >
            {{ ratio === 'free' ? '自由' : ratio }}
          </button>
          <span class="crop-size">
            {{ Math.round(cropDraft.width * cropItem.width) }} ×
            {{ Math.round(cropDraft.height * cropItem.height) }} px
          </span>
        </div>

        <div
          class="crop-stage"
          :style="{ width: `${cropDisplay.width}px`, height: `${cropDisplay.height}px` }"
        >
          <img
            :src="cropItem.sourceUrl"
            alt=""
            :style="{ width: `${cropDisplay.width}px`, height: `${cropDisplay.height}px` }"
            draggable="false"
          />
          <div
            class="crop-box"
            :style="cropBoxStyle"
            @pointerdown="beginCropDrag($event, 'move')"
          >
            <div class="grid-line v one" />
            <div class="grid-line v two" />
            <div class="grid-line h one" />
            <div class="grid-line h two" />
            <button
              v-for="corner in (['nw', 'ne', 'sw', 'se'] as const)"
              :key="corner"
              type="button"
              class="crop-handle"
              :class="corner"
              :aria-label="`拖动${corner}角`"
              @pointerdown="beginCropDrag($event, corner)"
            />
          </div>
        </div>

        <div class="crop-actions">
          <button type="button" class="btn" @click="resetCrop">重置全图</button>
          <span class="spacer" />
          <button type="button" class="btn" @click="closeCrop">取消</button>
          <button type="button" class="btn btn-primary" @click="applyCrop">应用裁剪</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  height: 100%;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  padding: 16px 18px 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.head h2 { margin: 0 0 4px; font-size: 18px; color: #303133; }
.head p { margin: 0 0 14px; font-size: 13px; color: #909399; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.inline, .flag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}
.num, .select {
  height: 32px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
}
.num { width: 84px; }
.btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn:hover:not(:disabled) { border-color: #ff7eb6; color: #ff7eb6; }
.btn-primary:hover { color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.file-btn { display: inline-flex; align-items: center; }
.msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #f0f9eb;
  color: #67c23a;
  border-radius: 6px;
  font-size: 13px;
}
.empty {
  padding: 48px 16px;
  text-align: center;
  color: #c0c4cc;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
}
.list { display: flex; flex-direction: column; gap: 10px; }
.item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 8px;
}
.thumb {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  background: #f5f7fa;
  flex: none;
}
.meta { flex: 1; min-width: 0; }
.name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.info { font-size: 12px; color: #909399; margin-top: 4px; }
.info.ok { color: #67c23a; }
.info.crop-info { color: #409eff; }
.animated-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 999px;
  color: #fff;
  background: #67c23a;
  font-size: 10px;
}
.actions { display: flex; gap: 6px; flex: none; }

.crop-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.68);
}
.crop-dialog {
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  overflow: auto;
  padding: 16px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}
.crop-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 10px;
}
.crop-head h3 {
  margin: 0 0 3px;
  font-size: 15px;
  color: #303133;
}
.crop-head p {
  margin: 0;
  font-size: 12px;
  color: #909399;
}
.close-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #909399;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.ratio-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #606266;
}
.ratio-btn {
  height: 26px;
  padding: 0 9px;
  border: 1px solid #dcdfe6;
  border-radius: 999px;
  background: #fff;
  color: #606266;
  cursor: pointer;
}
.ratio-btn.active {
  border-color: #ff7eb6;
  background: #fff0f5;
  color: #c4567a;
}
.crop-size {
  margin-left: auto;
  font-family: Consolas, monospace;
  color: #409eff;
}
.crop-stage {
  position: relative;
  overflow: hidden;
  margin: 0 auto;
  background: #222;
  user-select: none;
  touch-action: none;
}
.crop-stage > img {
  display: block;
  object-fit: fill;
  pointer-events: none;
}
.crop-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #fff;
  cursor: move;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.45),
    0 0 0 9999px rgba(0, 0, 0, 0.48);
}
.crop-box::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.08);
  pointer-events: none;
}
.grid-line {
  position: absolute;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.45);
}
.grid-line.v { top: 0; bottom: 0; width: 1px; }
.grid-line.h { left: 0; right: 0; height: 1px; }
.grid-line.v.one { left: 33.333%; }
.grid-line.v.two { left: 66.666%; }
.grid-line.h.one { top: 33.333%; }
.grid-line.h.two { top: 66.666%; }
.crop-handle {
  position: absolute;
  z-index: 2;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 3px solid #fff;
  background: #ff7eb6;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.crop-handle.nw { left: 0; top: 0; transform: translate(-50%, -50%); cursor: nwse-resize; }
.crop-handle.ne { right: 0; top: 0; transform: translate(50%, -50%); cursor: nesw-resize; }
.crop-handle.sw { left: 0; bottom: 0; transform: translate(-50%, 50%); cursor: nesw-resize; }
.crop-handle.se { right: 0; bottom: 0; transform: translate(50%, 50%); cursor: nwse-resize; }
.crop-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.spacer { flex: 1; }
</style>
