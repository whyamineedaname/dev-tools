<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

type PuzzleMode = 'grid' | 'hstack' | 'vstack' | 'free'

interface PuzzleImage {
  id: string
  name: string
  sourcePath?: string
  sourceUrl: string
  width: number
  height: number
  ratio: number // 宽高比（自由模式缩放保持比例用）
  // 自由模式：归一化坐标 0-1
  x: number
  y: number
  w: number
  h: number
}

const mode = ref<PuzzleMode>('grid')
const gridCols = ref(3)
const gridRows = ref(3)
const gap = ref(8)
const background = ref('#ffffff')
const cellSize = ref(500)
const images = ref<PuzzleImage[]>([])
const msg = ref('')
const busy = ref(false)
const previewUrl = ref('')
const previewW = ref(0)
const previewH = ref(0)
const selectedId = ref('')

// 自由模式画布：宽固定 1080，高按比例
const FREE_CANVAS_W = 1080
const canvasRatio = ref(1)
const canvasH = computed(() => Math.round(FREE_CANVAS_W / canvasRatio.value))
const selected = computed(() => images.value.find((i) => i.id === selectedId.value) || null)

const PRESETS: { id: PuzzleMode; name: string }[] = [
  { id: 'grid', name: '九宫/四格' },
  { id: 'hstack', name: '左右' },
  { id: 'vstack', name: '长图' },
  { id: 'free', name: '自由' }
]

const gridLabel = computed(() => `${gridCols.value}×${gridRows.value}`)

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function setGrid(cols: number, rows: number) {
  gridCols.value = cols
  gridRows.value = rows
  previewUrl.value = ''
}

function setMode(m: PuzzleMode) {
  mode.value = m
  previewUrl.value = ''
  msg.value = ''
}

function applyRatio(r: number) {
  canvasRatio.value = r
  previewUrl.value = ''
  msg.value = ''
}

async function loadFromPath(filePath: string, name: string) {
  const result = await window.electronAPI.file.readBinary(filePath)
  if (!result.success || !result.base64) throw new Error(result.error || '读取失败')
  const ext = name.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  const url = `data:${mime};base64,${result.base64}`
  const meta = await window.electronAPI.image.metadata(filePath).catch(() => null)
  const w = meta?.success ? meta.data.width : 1
  const h = meta?.success ? meta.data.height : 1
  const ratio = w / h
  // 自由模式：初始放在画布中央，宽度占 60%
  const isFree = mode.value === 'free'
  images.value.push({
    id: uid(),
    name,
    sourcePath: filePath,
    sourceUrl: url,
    width: w,
    height: h,
    ratio,
    x: isFree ? 0.2 : 0,
    y: isFree ? 0.2 : 0,
    w: isFree ? 0.6 : 0,
    h: isFree ? 0.6 / ratio : 0
  })
  if (isFree) selectedId.value = images.value[images.value.length - 1].id
}

async function pickFiles() {
  msg.value = ''
  previewUrl.value = ''
  const path = await window.electronAPI.dialog.openFile({
    title: '选择图片',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }]
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
  previewUrl.value = ''
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const withPath = file as File & { path?: string }
    if (!withPath.path) {
      msg.value = `无法读取「${file.name}」的本地路径，请改用「选择图片」按钮`
      continue
    }
    try {
      await loadFromPath(withPath.path, file.name)
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

function removeImage(id: string) {
  images.value = images.value.filter((i) => i.id !== id)
  if (selectedId.value === id) selectedId.value = ''
  previewUrl.value = ''
}

function clearAll() {
  images.value = []
  selectedId.value = ''
  previewUrl.value = ''
  msg.value = ''
}

// ---------- 自由模式画布交互 ----------

const canvasRef = ref<HTMLDivElement | null>(null)

let drag: {
  kind: 'move' | 'resize'
  id: string
  startX: number
  startY: number
  startX1: number
  startY1: number
  startW: number
  startH: number
} | null = null

function canvasDisplaySize() {
  const el = canvasRef.value
  if (!el) return { w: 1, h: 1 }
  const rect = el.getBoundingClientRect()
  return { w: rect.width || 1, h: rect.height || 1 }
}

function startMove(e: PointerEvent, img: PuzzleImage) {
  e.preventDefault()
  e.stopPropagation()
  selectedId.value = img.id
  drag = {
    kind: 'move',
    id: img.id,
    startX: e.clientX,
    startY: e.clientY,
    startX1: img.x,
    startY1: img.y,
    startW: img.w,
    startH: img.h
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag, { once: true })
}

function startResize(e: PointerEvent, img: PuzzleImage) {
  e.preventDefault()
  e.stopPropagation()
  selectedId.value = img.id
  drag = {
    kind: 'resize',
    id: img.id,
    startX: e.clientX,
    startY: e.clientY,
    startX1: img.x,
    startY1: img.y,
    startW: img.w,
    startH: img.h
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag, { once: true })
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return
  const img = images.value.find((i) => i.id === drag!.id)
  if (!img) return
  const { w: dw, h: dh } = canvasDisplaySize()
  const dx = (e.clientX - drag.startX) / dw
  const dy = (e.clientY - drag.startY) / dh

  if (drag.kind === 'move') {
    img.x = clamp(drag.startX1 + dx, 0, 1 - img.w)
    img.y = clamp(drag.startY1 + dy, 0, 1 - img.h)
  } else {
    // 缩放手柄：按对角线缩放，保持原比例
    const newW = clamp(drag.startW + dx, 0.08, 1 - img.x)
    const newH = newW / img.ratio
    if (img.y + newH <= 1.0001) {
      img.w = newW
      img.h = newH
    }
  }
}

function endDrag() {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function removeSelected() {
  if (selected.value) removeImage(selected.value.id)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
})

// ---------- 生成与保存 ----------

async function buildPuzzle() {
  msg.value = ''
  previewUrl.value = ''
  if (mode.value === 'free') {
    if (!images.value.length) {
      msg.value = '请先添加图片'
      return
    }
    busy.value = true
    try {
      const result = await window.electronAPI.image.puzzle({
        mode: 'free',
        items: images.value.map((i) => ({
          path: i.sourcePath!,
          x: i.x,
          y: i.y,
          width: i.w,
          height: i.h
        })),
        canvasWidth: FREE_CANVAS_W,
        canvasHeight: canvasH.value,
        background: background.value
      })
      if (!result.success) throw new Error(result.error)
      previewUrl.value = `data:image/png;base64,${result.base64}`
      previewW.value = result.width
      previewH.value = result.height
    } catch (e: unknown) {
      msg.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
    return
  }

  const paths = images.value.map((i) => i.sourcePath).filter((p): p is string => Boolean(p))
  if (!paths.length) {
    msg.value = '请先添加图片'
    return
  }
  if (mode.value === 'grid' && paths.length > gridCols.value * gridRows.value) {
    msg.value = `当前 ${gridCols.value}×${gridRows.value} 网格最多容纳 ${gridCols.value * gridRows.value} 张图，请移除多余的图片`
    return
  }
  busy.value = true
  try {
    const result = await window.electronAPI.image.puzzle({
      mode: mode.value,
      paths,
      gap: gap.value,
      background: background.value,
      cols: mode.value === 'grid' ? gridCols.value : undefined,
      rows: mode.value === 'grid' ? gridRows.value : undefined,
      cellSize: mode.value === 'grid' ? cellSize.value : undefined
    })
    if (!result.success) throw new Error(result.error)
    previewUrl.value = `data:image/png;base64,${result.base64}`
    previewW.value = result.width
    previewH.value = result.height
  } catch (e: unknown) {
    msg.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function savePuzzle() {
  if (!previewUrl.value) return
  msg.value = ''
  const defaultName = `拼图-${Date.now()}.png`
  const outPath = await window.electronAPI.dialog.saveFile({
    title: '保存拼图',
    defaultPath: defaultName,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  })
  if (!outPath) return
  const base64 = previewUrl.value.split(',')[1]
  const result = await window.electronAPI.file.writeBase64(outPath, base64)
  if (result.success) {
    msg.value = `已保存到 ${outPath}`
  } else {
    msg.value = result.error || '保存失败'
  }
}

function fmtPx(w: number, h: number) {
  return `${w} × ${h} px`
}
</script>

<template>
  <div class="tool-card" @dragover.prevent @drop="onDrop">
    <div class="head">
      <h2>🧩 图片拼图</h2>
      <p>九宫格、四格、左右拼接、长图拼接，以及可自由拖拽摆放的自由拼图</p>
    </div>

    <div class="mode-row">
      <button
        v-for="p in PRESETS"
        :key="p.id"
        type="button"
        class="mode-btn"
        :class="{ active: mode === p.id }"
        @click="setMode(p.id)"
      >
        {{ p.name }}
      </button>
    </div>

    <div class="toolbar">
      <button type="button" class="btn btn-primary" @click="pickFiles">选择图片</button>
      <label class="btn file-btn">
        批量添加
        <input type="file" accept="image/*" multiple hidden @change="onFileInput" />
      </label>
      <template v-if="mode === 'grid'">
        <div class="preset-group">
          <button
            type="button"
            class="preset-btn"
            :class="{ active: gridLabel === '3×3' }"
            @click="setGrid(3, 3)"
          >
            九宫格 3×3
          </button>
          <button
            type="button"
            class="preset-btn"
            :class="{ active: gridLabel === '2×2' }"
            @click="setGrid(2, 2)"
          >
            四格 2×2
          </button>
          <label class="inline">
            列
            <input v-model.number="gridCols" class="num" type="number" min="1" max="6" />
          </label>
          <label class="inline">
            行
            <input v-model.number="gridRows" class="num" type="number" min="1" max="6" />
          </label>
          <label class="inline">
            格宽(px)
            <input v-model.number="cellSize" class="num" type="number" min="100" max="2000" step="50" />
          </label>
        </div>
      </template>
      <template v-if="mode === 'free'">
        <div class="preset-group">
          <span class="inline-label">画布比例</span>
          <button
            v-for="(label, r) in { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '9:16': 9 / 16, '16:9': 16 / 9 }"
            :key="label"
            type="button"
            class="preset-btn"
            :class="{ active: canvasRatio === r }"
            @click="applyRatio(r)"
          >
            {{ label }}
          </button>
        </div>
      </template>
      <template v-if="mode !== 'free'">
        <label class="inline">
          间距(px)
          <input v-model.number="gap" class="num" type="number" min="0" max="80" />
        </label>
      </template>
      <label class="inline">
        背景色
        <input v-model="background" class="color" type="color" />
      </label>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="buildPuzzle">
        {{ busy ? '生成中…' : '生成拼图' }}
      </button>
      <button
        v-if="previewUrl"
        type="button"
        class="btn"
        :disabled="busy"
        @click="savePuzzle"
      >
        保存 PNG
      </button>
      <button type="button" class="btn" :disabled="!images.length" @click="clearAll">清空</button>
    </div>

    <div v-if="msg" class="msg">{{ msg }}</div>
    <div v-if="!images.length && !previewUrl" class="empty">拖拽图片到此处，或点击上方选择 / 批量添加</div>

    <!-- 自由拼图画布 -->
    <div v-if="mode === 'free' && images.length" class="free-stage">
      <div
        ref="canvasRef"
        class="free-canvas"
        :style="{ aspectRatio: `${FREE_CANVAS_W} / ${canvasH}` }"
      >
        <div
          v-for="img in images"
          :key="img.id"
          class="free-item"
          :class="{ selected: selectedId === img.id }"
          :style="{
            left: `${img.x * 100}%`,
            top: `${img.y * 100}%`,
            width: `${img.w * 100}%`,
            height: `${img.h * 100}%`
          }"
          @pointerdown="startMove($event, img)"
        >
          <img :src="img.sourceUrl" alt="" draggable="false" />
          <div
            class="resize-handle"
            @pointerdown.stop="startResize($event, img)"
          ></div>
        </div>
        <div class="canvas-tip">拖动图片移动，拖动右下角手柄缩放</div>
      </div>
      <div class="free-sidebar">
        <div v-if="selected" class="free-info">
          <div class="name">{{ selected.name }}</div>
          <div class="info">尺寸 {{ selected.width }}×{{ selected.height }}</div>
          <div class="info">
            位置 {{ Math.round(selected.x * 100) }}% / {{ Math.round(selected.y * 100) }}%
          </div>
          <div class="info">
            大小 {{ Math.round(selected.w * 100) }}% × {{ Math.round(selected.h * 100) }}%
          </div>
          <button type="button" class="btn btn-danger" @click="removeSelected">移除选中</button>
        </div>
        <div v-else class="free-info muted">点击画布中的图片可选中</div>
      </div>
    </div>

    <!-- 模板模式图片列表 -->
    <div v-if="mode !== 'free' && images.length" class="list">
      <div v-for="img in images" :key="img.id" class="item">
        <img class="thumb" :src="img.sourceUrl" alt="" />
        <div class="meta">
          <div class="name">{{ img.name }}</div>
          <div class="info">{{ img.width }}×{{ img.height }}</div>
        </div>
        <div class="actions">
          <button type="button" class="btn" @click="removeImage(img.id)">移除</button>
        </div>
      </div>
    </div>

    <!-- 预览结果 -->
    <div v-if="previewUrl" class="preview">
      <div class="preview-head">
        <span class="preview-title">预览 · {{ fmtPx(previewW, previewH) }}</span>
        <button type="button" class="btn" @click="previewUrl = ''">关闭</button>
      </div>
      <img class="preview-img" :src="previewUrl" alt="拼图结果" />
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

.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.mode-btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #dcdfe6;
  border-radius: 999px;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 13px;
}
.mode-btn.active {
  border-color: #ff7eb6;
  background: #fff0f5;
  color: #c4567a;
  font-weight: 600;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.preset-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.preset-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 12px;
}
.preset-btn.active {
  border-color: #409eff;
  background: #ecf5ff;
  color: #409eff;
}
.inline, .flag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}
.inline-label { font-size: 13px; color: #606266; }
.num {
  width: 70px;
  height: 28px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12px;
}
.color {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
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
.btn-danger { background: #f56c6c; border-color: #f56c6c; color: #fff; }
.btn:hover:not(:disabled) { border-color: #ff7eb6; color: #ff7eb6; }
.btn-primary:hover:not(:disabled), .btn-danger:hover:not(:disabled) { color: #fff; }
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

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #eee;
  border-radius: 8px;
}
.thumb {
  width: 56px;
  height: 56px;
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
.info { font-size: 12px; color: #909399; margin-top: 3px; }
.actions { display: flex; gap: 6px; flex: none; }

/* 自由拼图 */
.free-stage {
  display: flex;
  gap: 14px;
  margin-top: 12px;
  align-items: flex-start;
}
.free-canvas {
  position: relative;
  flex: none;
  width: 100%;
  max-width: 520px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background:
    linear-gradient(45deg, #f5f7fa 25%, transparent 25%, transparent 75%, #f5f7fa 75%),
    linear-gradient(45deg, #f5f7fa 25%, transparent 25%, transparent 75%, #f5f7fa 75%);
  background-size: 20px 20px;
  background-position: 0 0, 10px 10px;
  background-color: #fff;
  overflow: hidden;
  user-select: none;
  touch-action: none;
}
.free-item {
  position: absolute;
  border: 2px solid transparent;
  cursor: move;
}
.free-item.selected {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff;
}
.free-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  display: block;
}
.resize-handle {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  background: #409eff;
  border-radius: 50%;
  cursor: nwse-resize;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  display: none;
}
.free-item.selected .resize-handle { display: block; }
.canvas-tip {
  position: absolute;
  left: 8px;
  bottom: 8px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.free-sidebar {
  flex: 1;
  min-width: 180px;
  padding: 10px 12px;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #fafafa;
}
.free-info { display: flex; flex-direction: column; gap: 6px; }
.free-info .name { font-size: 13px; font-weight: 600; color: #303133; }
.free-info .info { font-size: 12px; color: #909399; margin: 0; }
.free-info.muted { color: #c0c4cc; font-size: 12px; }

/* 预览 */
.preview {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafafa;
}
.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.preview-title { font-size: 13px; font-weight: 600; color: #303133; }
.preview-img {
  display: block;
  max-width: 100%;
  max-height: 60vh;
  margin: 0 auto;
  border-radius: 6px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
</style>
