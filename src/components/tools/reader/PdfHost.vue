<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  AnnotTool,
  InkStroke,
  PageNote,
  ReaderLocation,
  RelPoint
} from '@/types/reader'
import { PEN_COLORS, NOTE_COLORS } from '@/types/reader'
import { useReaderAnnotations } from '@/composables/useReaderAnnotations'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import './reader.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

/** 与 reader.css 中 .pdf-canvas-wrap 的 padding 保持一致 */
const WRAP_PADDING = 8
const MIN_SCALE = 0.25
const MAX_SCALE = 5
const DEFAULT_PEN_WIDTH = 0.004
/** 上下方向键单次滚动的像素距离 */
const KEY_SCROLL_STEP = 80

type FitMode = 'width' | 'page' | 'custom'

const props = defineProps<{
  data: ArrayBuffer | null
  fileHash: string
  initialLocation: ReaderLocation | null
}>()

const emit = defineEmits<{
  relocate: [detail: { index: number; fraction?: number }]
  error: [message: string]
  ready: []
}>()

const wrapRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const inkRef = ref<HTMLCanvasElement | null>(null)
const page = ref(1)
const pageCount = ref(0)
const loading = ref(false)
const fitMode = ref<FitMode>('width')
const renderScale = ref(1)
const pageCssW = ref(0)
const pageCssH = ref(0)

const tool = ref<AnnotTool>('hand')
const penColor = ref<string>(PEN_COLORS[0])
const penWidth = ref(DEFAULT_PEN_WIDTH)
const noteColor = ref<string>(NOTE_COLORS[0])
const showNotesPanel = ref(true)
const editingNote = ref<PageNote | null>(null)
const draftText = ref('')
const draftTags = ref('')
const annot = useReaderAnnotations()

let pdfDoc: PDFDocumentProxy | null = null
let renderTask: RenderTask | null = null
let customScale = 1
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let drawing = false
let currentPoints: RelPoint[] = []

const currentPageInks = computed(() => annot.inks.value.filter((s) => s.page === page.value - 1))
const currentPageNotes = computed(() => annot.notes.value.filter((n) => n.page === page.value - 1))
const allNotesSorted = computed(() =>
  [...annot.notes.value].sort((a, b) => a.page - b.page || b.updatedAt - a.updatedAt)
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'RenderingCancelledException'
}

function computeScale(pdfPage: PDFPageProxy): number {
  const wrap = wrapRef.value
  if (!wrap || fitMode.value === 'custom') return customScale
  const base = pdfPage.getViewport({ scale: 1 })
  const availWidth = Math.max(160, wrap.clientWidth - WRAP_PADDING * 2)
  const availHeight = Math.max(160, wrap.clientHeight - WRAP_PADDING * 2)
  const widthScale = availWidth / base.width
  if (fitMode.value === 'width') return clamp(widthScale, MIN_SCALE, MAX_SCALE)
  return clamp(Math.min(widthScale, availHeight / base.height), MIN_SCALE, MAX_SCALE)
}

function emitRelocate(): void {
  const fraction = pageCount.value > 0 ? (page.value - 1) / pageCount.value : 0
  emit('relocate', { index: page.value - 1, fraction })
}

function syncInkCanvasSize(): void {
  const ink = inkRef.value
  if (!ink || !pageCssW.value || !pageCssH.value) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  ink.width = Math.floor(pageCssW.value * dpr)
  ink.height = Math.floor(pageCssH.value * dpr)
  ink.style.width = `${pageCssW.value}px`
  ink.style.height = `${pageCssH.value}px`
  const ctx = ink.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  redrawInks()
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  cssW: number,
  cssH: number
): void {
  if (stroke.points.length < 2) return
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = Math.max(1, stroke.width * cssW)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x * cssW, stroke.points[0].y * cssH)
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x * cssW, stroke.points[i].y * cssH)
  }
  ctx.stroke()
}

function redrawInks(): void {
  const ink = inkRef.value
  if (!ink) return
  const ctx = ink.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, pageCssW.value, pageCssH.value)
  for (const stroke of currentPageInks.value) {
    drawStroke(ctx, stroke, pageCssW.value, pageCssH.value)
  }
  if (currentPoints.length >= 2) {
    drawStroke(
      ctx,
      {
        id: 'draft',
        page: page.value - 1,
        color: penColor.value,
        width: penWidth.value,
        points: currentPoints,
        createdAt: 0
      },
      pageCssW.value,
      pageCssH.value
    )
  }
}

async function renderPage(num: number, notify = true): Promise<void> {
  const canvas = canvasRef.value
  if (!pdfDoc || !canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pdfPage = await pdfDoc.getPage(num)
  const scale = computeScale(pdfPage)
  const viewport = pdfPage.getViewport({ scale })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const cssW = Math.floor(viewport.width)
  const cssH = Math.floor(viewport.height)

  renderTask?.cancel()
  canvas.width = Math.floor(cssW * dpr)
  canvas.height = Math.floor(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  pageCssW.value = cssW
  pageCssH.value = cssH

  const task = pdfPage.render({
    canvasContext: ctx,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]
  })
  renderTask = task
  try {
    await task.promise
  } catch (err: unknown) {
    if (isCancelled(err)) return
    throw err
  }

  renderScale.value = scale
  page.value = num
  await nextTick()
  syncInkCanvasSize()
  if (notify) emitRelocate()
}

async function safeRender(num: number, notify = true): Promise<void> {
  try {
    await renderPage(num, notify)
  } catch (err: unknown) {
    emit('error', err instanceof Error ? err.message : String(err))
  }
}

async function openPdf(data: ArrayBuffer, loc: ReaderLocation | null): Promise<void> {
  loading.value = true
  try {
    await annot.dispose()
    await pdfDoc?.destroy()
    pdfDoc = await pdfjs.getDocument({ data: data.slice(0) }).promise
    pageCount.value = pdfDoc.numPages
    fitMode.value = 'width'
    tool.value = 'hand'
    if (props.fileHash) await annot.load(props.fileHash)
    let start = 1
    if (loc?.kind === 'page' && loc.page >= 0) {
      start = clamp(loc.page + 1, 1, pageCount.value)
    } else if (loc?.fraction != null && pageCount.value > 0) {
      start = clamp(Math.floor(loc.fraction * pageCount.value) + 1, 1, pageCount.value)
    }
    await nextTick()
    await renderPage(start)
    emit('ready')
  } catch (err: unknown) {
    emit('error', err instanceof Error ? err.message : String(err))
  } finally {
    loading.value = false
  }
}

async function goToPage(num: number): Promise<void> {
  const target = clamp(num, 1, pageCount.value || 1)
  if (target === page.value) return
  wrapRef.value?.scrollTo({ top: 0 })
  await safeRender(target)
}

async function setZoom(scale: number): Promise<void> {
  customScale = clamp(scale, MIN_SCALE, MAX_SCALE)
  fitMode.value = 'custom'
  await safeRender(page.value, false)
}

async function setFitMode(mode: Exclude<FitMode, 'custom'>): Promise<void> {
  fitMode.value = mode
  await safeRender(page.value, false)
}

function pointerToRel(e: PointerEvent): RelPoint | null {
  const ink = inkRef.value
  if (!ink || !pageCssW.value || !pageCssH.value) return null
  const rect = ink.getBoundingClientRect()
  return {
    x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((e.clientY - rect.top) / rect.height, 0, 1)
  }
}

function onPointerDown(e: PointerEvent): void {
  if (tool.value === 'hand') return
  const pt = pointerToRel(e)
  if (!pt) return
  if (tool.value === 'eraser') {
    eraseNear(pt)
    return
  }
  if (tool.value === 'note') {
    openNewNote(pt)
    return
  }
  if (tool.value === 'pen') {
    drawing = true
    currentPoints = [pt]
    inkRef.value?.setPointerCapture(e.pointerId)
    redrawInks()
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!drawing || tool.value !== 'pen') return
  const pt = pointerToRel(e)
  if (!pt) return
  const last = currentPoints[currentPoints.length - 1]
  const dx = pt.x - last.x
  const dy = pt.y - last.y
  if (dx * dx + dy * dy < 0.00000025) return
  currentPoints.push(pt)
  redrawInks()
}

function onPointerUp(e: PointerEvent): void {
  if (!drawing) return
  drawing = false
  try {
    inkRef.value?.releasePointerCapture(e.pointerId)
  } catch {
    // ignore
  }
  if (currentPoints.length >= 2) {
    annot.addStroke({
      page: page.value - 1,
      color: penColor.value,
      width: penWidth.value,
      points: [...currentPoints]
    })
  }
  currentPoints = []
  redrawInks()
}

function eraseNear(pt: RelPoint): void {
  const threshold = 0.02
  const pageIndex = page.value - 1
  let bestId: string | null = null
  let bestDist = threshold
  for (const stroke of annot.inks.value) {
    if (stroke.page !== pageIndex) continue
    for (const p of stroke.points) {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y)
      if (d < bestDist) {
        bestDist = d
        bestId = stroke.id
      }
    }
  }
  if (bestId) {
    annot.removeStroke(bestId)
    redrawInks()
  }
}

function openNewNote(pt: RelPoint): void {
  const note = annot.addNote({
    page: page.value - 1,
    x: pt.x,
    y: pt.y,
    text: '',
    tags: [],
    color: noteColor.value
  })
  editingNote.value = note
  draftText.value = ''
  draftTags.value = ''
}

function openEditNote(note: PageNote): void {
  editingNote.value = note
  draftText.value = note.text
  draftTags.value = note.tags.join(', ')
  noteColor.value = note.color
  if (note.page + 1 !== page.value) void goToPage(note.page + 1)
}

function saveNoteDraft(): void {
  if (!editingNote.value) return
  const tags = draftTags.value
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
  annot.updateNote(editingNote.value.id, {
    text: draftText.value.trim(),
    tags,
    color: noteColor.value
  })
  editingNote.value = null
}

function cancelNoteDraft(): void {
  if (editingNote.value && !editingNote.value.text.trim()) {
    annot.removeNote(editingNote.value.id)
  }
  editingNote.value = null
}

function deleteEditingNote(): void {
  if (!editingNote.value) return
  annot.removeNote(editingNote.value.id)
  editingNote.value = null
}

function noteStyle(note: PageNote): Record<string, string> {
  return {
    left: `${note.x * 100}%`,
    top: `${note.y * 100}%`,
    background: note.color
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function scrollPageBy(delta: number): void {
  wrapRef.value?.scrollBy({ top: delta })
}

function onKeyDown(e: KeyboardEvent): void {
  if (!pdfDoc || loading.value || editingNote.value || isTypingTarget(e.target)) return
  if (e.altKey || e.ctrlKey || e.metaKey) return

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault()
      void goToPage(page.value - 1)
      break
    case 'ArrowRight':
      e.preventDefault()
      void goToPage(page.value + 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      scrollPageBy(-KEY_SCROLL_STEP)
      break
    case 'ArrowDown':
      e.preventDefault()
      scrollPageBy(KEY_SCROLL_STEP)
      break
    case 'PageUp':
      e.preventDefault()
      scrollPageBy(-(wrapRef.value?.clientHeight ?? KEY_SCROLL_STEP))
      break
    case 'PageDown':
      e.preventDefault()
      scrollPageBy(wrapRef.value?.clientHeight ?? KEY_SCROLL_STEP)
      break
    default:
      break
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  if (!wrapRef.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    if (fitMode.value === 'custom' || !pdfDoc) return
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => void safeRender(page.value, false), 150)
  })
  resizeObserver.observe(wrapRef.value)
})

watch(
  () => [props.data, props.fileHash] as const,
  ([data]) => {
    if (data) void openPdf(data, props.initialLocation)
  },
  { immediate: true }
)

watch(currentPageInks, () => redrawInks(), { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  renderTask?.cancel()
  void annot.dispose()
  void pdfDoc?.destroy()
  pdfDoc = null
})
</script>

<template>
  <div class="pdf-host with-side">
    <div class="pdf-main">
      <div class="pdf-toolbar">
        <button type="button" class="btn" :disabled="page <= 1 || loading" @click="goToPage(page - 1)">
          上一页
        </button>
        <span class="page-label">{{ page }} / {{ pageCount || '—' }}</span>
        <button
          type="button"
          class="btn"
          :disabled="page >= pageCount || loading"
          @click="goToPage(page + 1)"
        >
          下一页
        </button>

        <span class="divider" />

        <button type="button" class="btn" :disabled="loading" @click="setZoom(renderScale - 0.2)">
          缩小
        </button>
        <span class="zoom-label">{{ Math.round(renderScale * 100) }}%</span>
        <button type="button" class="btn" :disabled="loading" @click="setZoom(renderScale + 0.2)">
          放大
        </button>

        <span class="divider" />

        <button
          type="button"
          class="btn"
          :class="{ active: fitMode === 'width' }"
          :disabled="loading"
          @click="setFitMode('width')"
        >
          适应宽度
        </button>
        <button
          type="button"
          class="btn"
          :class="{ active: fitMode === 'page' }"
          :disabled="loading"
          @click="setFitMode('page')"
        >
          适应页面
        </button>
        <span class="divider" />
        <button type="button" class="btn" :class="{ active: tool === 'hand' }" @click="tool = 'hand'">浏览</button>
        <button type="button" class="btn tool-btn" :class="{ active: tool === 'pen' }" title="画笔：在页面自由标记" @click="tool = 'pen'">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m4 20 4.2-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z" />
            <path d="m14.8 6.2 3 3M4 20l4.2-1-3.2-3L4 20Z" />
          </svg>
          <span>画笔</span>
        </button>
        <button type="button" class="btn tool-btn" :class="{ active: tool === 'note' }" title="笔记：点击页面添加带标签的笔记" @click="tool = 'note'">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
            <path d="M7 8h10M7 12h7" />
          </svg>
          <span>笔记</span>
        </button>
        <button type="button" class="btn tool-btn" :class="{ active: tool === 'eraser' }" title="橡皮：拖动擦除画笔标记" @click="tool = 'eraser'">
          <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m7.5 18.5-4-4a2 2 0 0 1 0-2.8l8.2-8.2a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8l-6.2 6.2H7.5Z" />
            <path d="m9 6.2 8.8 8.8M7.5 18.5H21" />
          </svg>
          <span>橡皮</span>
        </button>
        <template v-if="tool === 'pen'">
          <span class="divider" />
          <button
            v-for="c in PEN_COLORS"
            :key="c"
            type="button"
            class="swatch"
            :class="{ active: penColor === c }"
            :style="{ background: c }"
            @click="penColor = c"
          />
          <select v-model.number="penWidth" class="width-select">
            <option :value="0.002">细</option>
            <option :value="0.004">中</option>
            <option :value="0.008">粗</option>
          </select>
        </template>
        <span class="spacer" />
        <button type="button" class="btn" @click="showNotesPanel = !showNotesPanel">
          {{ showNotesPanel ? '隐藏笔记' : '笔记列表' }}
        </button>
        <span v-if="annot.saving.value" class="saving">保存中</span>
      </div>
      <div ref="wrapRef" class="pdf-canvas-wrap">
        <div
          class="pdf-page-stack"
          :class="{ drawing: tool !== 'hand' }"
          :style="{ width: pageCssW ? pageCssW + 'px' : undefined }"
        >
          <canvas ref="canvasRef" class="pdf-page-canvas" />
          <canvas
            ref="inkRef"
            class="pdf-ink-canvas"
            :class="[`tool-${tool}`, { interactive: tool !== 'hand' }]"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          />
          <button
            v-for="note in currentPageNotes"
            :key="note.id"
            type="button"
            class="note-pin"
            :style="noteStyle(note)"
            :title="note.text || '空笔记'"
            @click.stop="openEditNote(note)"
          >
            📝
          </button>
        </div>
      </div>
    </div>

    <aside v-if="showNotesPanel" class="notes-panel">
      <div class="notes-panel-head">
        <h4>笔记 / 标签</h4>
        <span>{{ allNotesSorted.length }}</span>
      </div>
      <div v-if="allNotesSorted.length === 0" class="notes-empty">选择「笔记」后点击页面添加</div>
      <ul v-else class="notes-list">
        <li
          v-for="note in allNotesSorted"
          :key="note.id"
          class="notes-item"
          @click="openEditNote(note)"
        >
          <div class="notes-item-top">
            <span class="notes-page">P{{ note.page + 1 }}</span>
            <span class="notes-time">{{ new Date(note.updatedAt).toLocaleString() }}</span>
          </div>
          <div class="notes-text">{{ note.text || '（空笔记）' }}</div>
          <div v-if="note.tags.length" class="notes-tags">
            <span v-for="tag in note.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </li>
      </ul>
    </aside>

    <div v-if="editingNote" class="note-modal-mask" @click.self="cancelNoteDraft">
      <div class="note-modal">
        <h4>编辑笔记 · 第 {{ editingNote.page + 1 }} 页</h4>
        <textarea v-model="draftText" rows="5" placeholder="写下批注内容" />
        <input v-model="draftTags" type="text" placeholder="标签，逗号分隔" />
        <div class="note-modal-actions">
          <button type="button" class="btn danger" @click="deleteEditingNote">删除</button>
          <span class="spacer" />
          <button type="button" class="btn" @click="cancelNoteDraft">取消</button>
          <button type="button" class="btn primary" @click="saveNoteDraft">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-host.with-side {
  display: flex;
  flex-direction: row;
  background: #f5f5f5;
}
.pdf-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}
.btn {
  padding: 4px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn:not(:disabled):hover {
  border-color: #409eff;
  color: #409eff;
}
.btn.active {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tool-icon {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.btn.primary {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.btn.danger {
  border-color: #f56c6c;
  color: #f56c6c;
}
.page-label,
.zoom-label,
.saving {
  font-size: 13px;
  color: #606266;
  min-width: 48px;
  text-align: center;
}
.divider {
  width: 1px;
  height: 16px;
  background: #e4e7ed;
}
.spacer {
  flex: 1;
}
.swatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
}
.swatch.active {
  border-color: #303133;
}
.width-select {
  height: 26px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 12px;
}
.notes-panel {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid #e4e7ed;
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.notes-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
}
.notes-panel-head h4 {
  margin: 0;
  font-size: 13px;
}
.notes-panel-head span {
  font-size: 12px;
  color: #909399;
}
.notes-empty {
  padding: 24px 14px;
  color: #c0c4cc;
  font-size: 12px;
  text-align: center;
}
.notes-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
  flex: 1;
}
.notes-item {
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
}
.notes-item:hover {
  border-color: #409eff;
  background: #f5f9ff;
}
.notes-item-top {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #909399;
  margin-bottom: 4px;
}
.notes-page {
  color: #409eff;
  font-weight: 600;
}
.notes-text {
  font-size: 13px;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
}
.notes-tags {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: #ecf5ff;
  color: #409eff;
}
.note-modal-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.note-modal {
  width: min(420px, 90%);
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-modal h4 {
  margin: 0;
  font-size: 14px;
}
.note-modal textarea,
.note-modal input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}
.note-modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
