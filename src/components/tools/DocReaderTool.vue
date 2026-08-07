<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import FoliateHost from '@/components/tools/reader/FoliateHost.vue'
import PdfHost from '@/components/tools/reader/PdfHost.vue'
import { base64ToArrayBuffer, sha256Hex } from '@/utils/fileHash'
import { useReaderProgress, locationFromRelocate } from '@/composables/useReaderProgress'
import type { ReaderLocation, ReaderRecentItem } from '@/types/reader'

const sourceFile = ref('')
const fileName = ref('')
const fileHash = ref('')
const loading = ref(false)
const resultMsg = ref('')
const resultType = ref<'success' | 'error' | ''>('')
const progressLabel = ref('')
const recentItems = ref<ReaderRecentItem[]>([])
const recentLoading = ref(false)

const ebookFile = ref<File | null>(null)
const pdfData = ref<ArrayBuffer | null>(null)
const initialLocation = ref<ReaderLocation | null>(null)
const mode = ref<'idle' | 'ebook' | 'pdf'>('idle')

const { saving, load, listRecent, scheduleSave, dispose } = useReaderProgress()

const PDF_EXTS = new Set(['pdf'])
const EBOOK_EXTS = new Set(['epub', 'mobi', 'azw3', 'azw', 'fb2', 'cbz'])

function extOf(path: string): string {
  return (path.split(/[/\\]/).pop()?.split('.').pop() || '').toLowerCase()
}

function mimeFromPath(p: string): string {
  const ext = extOf(p)
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
    azw3: 'application/vnd.amazon.ebook',
    azw: 'application/vnd.amazon.ebook',
    fb2: 'application/x-fictionbook+xml',
    cbz: 'application/vnd.comicbook+zip'
  }
  return map[ext] || 'application/octet-stream'
}

function formatProgress(item: ReaderRecentItem): string {
  const { location } = item
  if (location.fraction != null) return `${Math.round(location.fraction * 100)}%`
  if (location.kind === 'page') return `第 ${location.page + 1} 页`
  return '已读'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatIcon(name: string): string {
  const ext = extOf(name)
  if (ext === 'pdf') return '📕'
  if (ext === 'epub') return '📗'
  if (ext === 'mobi' || ext === 'azw' || ext === 'azw3') return '📘'
  return '📄'
}

const canBrowse = computed(() => !loading.value)

function resetViewer(): void {
  ebookFile.value = null
  pdfData.value = null
  initialLocation.value = null
  mode.value = 'idle'
  progressLabel.value = ''
  sourceFile.value = ''
  fileName.value = ''
  fileHash.value = ''
}

async function refreshRecent(): Promise<void> {
  recentLoading.value = true
  try {
    recentItems.value = await listRecent(10)
  } catch (e: unknown) {
    console.error('[reader] listRecent', e)
    recentItems.value = []
  } finally {
    recentLoading.value = false
  }
}

async function openPath(path: string): Promise<void> {
  const ext = extOf(path)
  if (!PDF_EXTS.has(ext) && !EBOOK_EXTS.has(ext)) {
    resultMsg.value = `不支持的格式：.${ext || '?'}`
    resultType.value = 'error'
    return
  }

  loading.value = true
  resultMsg.value = '正在加载…'
  resultType.value = ''
  resetViewer()
  sourceFile.value = path
  fileName.value = path.split(/[/\\]/).pop() || path

  try {
    const bin = await window.electronAPI.file.readBinary(path)
    if (!bin.success || !bin.base64) {
      throw new Error(bin.error || '读取文件失败')
    }
    const buffer = base64ToArrayBuffer(bin.base64)
    const hash = await sha256Hex(buffer)
    fileHash.value = hash

    const saved = await load(hash)
    initialLocation.value = saved?.location ?? null

    if (PDF_EXTS.has(ext)) {
      pdfData.value = buffer
      mode.value = 'pdf'
    } else {
      ebookFile.value = new File([buffer], fileName.value, { type: mimeFromPath(path) })
      mode.value = 'ebook'
    }

    resultMsg.value = saved
      ? `已恢复上次阅读位置（${new Date(saved.updatedAt).toLocaleString()}）`
      : '文件已打开'
    resultType.value = 'success'
    void refreshRecent()
  } catch (e: unknown) {
    resultMsg.value = e instanceof Error ? e.message : String(e)
    resultType.value = 'error'
    resetViewer()
    void refreshRecent()
  } finally {
    loading.value = false
  }
}

async function selectSourceFile(): Promise<void> {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择文档',
    filters: [
      {
        name: '支持的文档',
        extensions: ['pdf', 'epub', 'mobi', 'azw3', 'azw', 'fb2', 'cbz']
      },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (!path) return
  await openPath(path)
}

async function openRecent(item: ReaderRecentItem): Promise<void> {
  if (!item.exists) {
    resultMsg.value = `文件不存在或无法访问：${item.filePath}`
    resultType.value = 'error'
    return
  }
  await openPath(item.filePath)
}

function onRelocate(detail: { cfi?: string; index?: number; fraction?: number }): void {
  if (!fileHash.value || !sourceFile.value) return
  const location = locationFromRelocate(detail)
  scheduleSave({
    fileHash: fileHash.value,
    filePath: sourceFile.value,
    fileName: fileName.value,
    location,
    updatedAt: Date.now()
  })
  if (detail.fraction != null) {
    progressLabel.value = `${Math.round(detail.fraction * 100)}%`
  } else if (location.kind === 'page') {
    progressLabel.value = `第 ${location.page + 1} 页`
  } else {
    progressLabel.value = '阅读中'
  }
}

function onError(message: string): void {
  resultMsg.value = message
  resultType.value = 'error'
}

onMounted(() => {
  void refreshRecent()
})

onBeforeUnmount(() => {
  dispose()
})
</script>

<template>
  <div class="reader-page">
    <div class="reader-toolbar">
      <div class="title-row">
        <h2 class="tool-title">📖 文档阅读器</h2>
        <p class="tool-desc">支持 PDF、EPUB、MOBI、AZW3 等，自动记忆阅读位置</p>
      </div>
      <div class="actions">
        <button class="btn btn-primary" :disabled="!canBrowse" @click="selectSourceFile">
          选择文件
        </button>
        <span v-if="fileName" class="file-meta" :title="sourceFile">{{ fileName }}</span>
        <span v-if="progressLabel" class="progress-meta">{{ progressLabel }}</span>
        <span v-if="saving" class="saving-meta">保存中…</span>
      </div>
      <div v-if="resultMsg" class="result-msg" :class="resultType">{{ resultMsg }}</div>
    </div>

    <div class="reader-body">
      <div v-if="mode === 'idle'" class="recent-panel">
        <div class="recent-header">
          <h3>最近阅读</h3>
          <span class="recent-sub">最多显示 10 条</span>
        </div>

        <div v-if="recentLoading" class="recent-empty">加载中…</div>
        <div v-else-if="recentItems.length === 0" class="recent-empty">
          暂无阅读记录，点击上方「选择文件」开始阅读
        </div>
        <ul v-else class="recent-list">
          <li
            v-for="item in recentItems"
            :key="item.fileHash"
            class="recent-item"
            :class="{ missing: !item.exists }"
            :title="item.filePath"
            @click="openRecent(item)"
          >
            <span class="recent-icon">{{ formatIcon(item.fileName) }}</span>
            <div class="recent-main">
              <div class="recent-name">{{ item.fileName }}</div>
              <div class="recent-path">{{ item.filePath }}</div>
            </div>
            <div class="recent-meta">
              <span class="recent-progress">{{ formatProgress(item) }}</span>
              <span class="recent-time">{{ formatTime(item.updatedAt) }}</span>
              <span v-if="!item.exists" class="recent-missing">文件缺失</span>
            </div>
          </li>
        </ul>
      </div>

      <FoliateHost
        v-else-if="mode === 'ebook'"
        :file="ebookFile"
        :initial-location="initialLocation"
        @relocate="onRelocate"
        @error="onError"
      />
      <PdfHost
        v-else-if="mode === 'pdf'"
        :data="pdfData"
        :file-hash="fileHash"
        :initial-location="initialLocation"
        @relocate="onRelocate"
        @error="onError"
      />
    </div>
  </div>
</template>

<style scoped>
.reader-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 104px);
  min-height: 560px;
  margin: -12px -12px -8px;
}

.reader-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: #fff;
  border-radius: 8px;
  margin-bottom: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.tool-title {
  margin: 0;
  font-size: 16px;
  white-space: nowrap;
  color: #303133;
}

.tool-desc {
  margin: 0;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-left: auto;
}

.btn {
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: #409eff;
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary:not(:disabled):hover {
  background: #66b1ff;
}

.file-meta {
  font-size: 13px;
  color: #606266;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-meta,
.saving-meta {
  font-size: 12px;
  color: #909399;
}

.result-msg {
  flex-basis: 100%;
  margin-top: 2px;
  font-size: 12px;
}

.result-msg.success {
  color: #67c23a;
}

.result-msg.error {
  color: #f56c6c;
}

.reader-body {
  flex: 1;
  min-height: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.recent-panel {
  height: 100%;
  overflow: auto;
  padding: 20px 24px;
}

.recent-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}

.recent-header h3 {
  margin: 0;
  font-size: 15px;
  color: #303133;
  font-weight: 600;
}

.recent-sub {
  font-size: 12px;
  color: #c0c4cc;
}

.recent-empty {
  padding: 48px 16px;
  text-align: center;
  color: #c0c4cc;
  font-size: 14px;
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.recent-item:hover {
  border-color: #409eff;
  background: #f5f9ff;
}

.recent-item.missing {
  opacity: 0.72;
}

.recent-item.missing:hover {
  border-color: #f56c6c;
  background: #fef0f0;
}

.recent-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
}

.recent-main {
  flex: 1;
  min-width: 0;
}

.recent-name {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-path {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-meta {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  min-width: 72px;
}

.recent-progress {
  font-size: 13px;
  color: #409eff;
  font-weight: 500;
}

.recent-time {
  font-size: 12px;
  color: #c0c4cc;
}

.recent-missing {
  font-size: 11px;
  color: #f56c6c;
}
</style>
