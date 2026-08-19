<script setup lang="ts">
import { ref } from 'vue'

type TabKey = 'capture' | 'batch' | 'pdf' | 'qrcode'

interface BatchItem {
  path: string
  text: string
  error: string
}

interface PdfPage {
  page: number
  text: string
}

interface QrCode {
  type: string
  data: string
}

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'capture', label: '截图识别' },
  { key: 'batch', label: '批量识别' },
  { key: 'pdf', label: 'PDF 识别' },
  { key: 'qrcode', label: '二维码' }
]

const activeTab = ref<TabKey>('capture')
const running = ref(false)

/** 串行保护：识别进行中禁止再次触发，结束统一复位 running */
async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (running.value) return undefined
  running.value = true
  try {
    return await fn()
  } finally {
    running.value = false
  }
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* 剪贴板写入失败时静默处理 */
  }
}

/* ---------------- 截图识别 ---------------- */

const shotDataUrl = ref('')
const shotText = ref('')
const shotQr = ref<QrCode[]>([])
const shotError = ref('')
const shotQrError = ref('')

async function captureText() {
  shotError.value = ''
  shotText.value = ''
  shotQr.value = []
  shotQrError.value = ''
  await run(async () => {
    const capture = await window.electronAPI.ocr.captureRegion()
    if (!capture.success) {
      if (!capture.cancelled) shotError.value = capture.error || '截图失败'
      return
    }
    shotDataUrl.value = capture.dataUrl
    const result = await window.electronAPI.ocr.fromDataUrl('image', capture.dataUrl)
    if (!result.success) {
      shotError.value = result.error || '识别失败'
      return
    }
    shotText.value = result.text || ''
  })
}

async function captureQr() {
  shotQr.value = []
  shotQrError.value = ''
  await run(async () => {
    let url = shotDataUrl.value
    if (!url) {
      const capture = await window.electronAPI.ocr.captureRegion()
      if (!capture.success) {
        if (!capture.cancelled) shotQrError.value = capture.error || '截图失败'
        return
      }
      url = capture.dataUrl
      shotDataUrl.value = url
    }
    const result = await window.electronAPI.ocr.fromDataUrl('qrcode', url)
    if (!result.success) {
      shotQrError.value = result.error || '识别失败'
      return
    }
    shotQr.value = result.codes || []
  })
}

/* ---------------- 批量识别 ---------------- */

const batchItems = ref<BatchItem[]>([])
const batchError = ref('')

async function batchRun() {
  batchError.value = ''
  batchItems.value = []
  const paths = await window.electronAPI.dialog.openFiles({
    title: '选择多张图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  })
  if (!paths || paths.length === 0) return
  await run(async () => {
    const result = await window.electronAPI.ocr.batch(paths)
    if (!result.success) {
      batchError.value = result.error || '批量识别失败'
      return
    }
    batchItems.value = result.items || []
  })
}

function batchSuccessText(): string {
  return batchItems.value
    .filter((item) => !item.error)
    .map((item) => `--- ${baseName(item.path)} ---\n${item.text}`)
    .join('\n\n')
}

async function copyBatch() {
  await copyText(batchSuccessText())
}

/* ---------------- PDF 识别 ---------------- */

const pdfPages = ref<PdfPage[]>([])
const pdfName = ref('')
const pdfError = ref('')

async function pdfRun() {
  pdfError.value = ''
  pdfPages.value = []
  pdfName.value = ''
  const paths = await window.electronAPI.dialog.openFiles({
    title: '选择 PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  const path = paths?.[0]
  if (!path) return
  pdfName.value = baseName(path)
  await run(async () => {
    const result = await window.electronAPI.ocr.pdf(path)
    if (!result.success) {
      pdfError.value = result.error || 'PDF 识别失败'
      return
    }
    pdfPages.value = result.pages || []
  })
}

async function copyPdf() {
  const text = pdfPages.value
    .map((p) => `--- 第 ${p.page} 页 ---\n${p.text}`)
    .join('\n\n')
  await copyText(text)
}

/* ---------------- 二维码识别 ---------------- */

const qrCodes = ref<QrCode[]>([])
const qrError = ref('')

async function qrRun() {
  qrError.value = ''
  qrCodes.value = []
  const paths = await window.electronAPI.dialog.openFiles({
    title: '选择含二维码的图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
  })
  const path = paths?.[0]
  if (!path) return
  await run(async () => {
    const result = await window.electronAPI.ocr.qrcode(path)
    if (!result.success) {
      qrError.value = result.error || '识别失败'
      return
    }
    qrCodes.value = result.codes || []
  })
}

async function copyQr(data: string) {
  await copyText(data)
}
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>OCR 文字识别</h2>
      <p>本地离线识别图片、扫描 PDF 与二维码，图片不会上传</p>
    </div>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 截图识别 -->
    <section v-if="activeTab === 'capture'" class="section">
      <div class="row">
        <button type="button" class="btn btn-primary" :disabled="running" @click="captureText">
          {{ running ? '处理中…' : '📷 开始截图识别' }}
        </button>
        <button type="button" class="btn" :disabled="running" @click="captureQr">
          识别二维码
        </button>
      </div>
      <div v-if="shotError" class="error-bar">{{ shotError }}</div>
      <div v-if="shotDataUrl" class="scan-preview">
        <img :src="shotDataUrl" alt="截图预览" />
      </div>
      <div v-if="shotText" class="field">
        <label>识别结果</label>
        <textarea class="textarea" rows="6" readonly :value="shotText" />
      </div>
      <div v-if="shotQr.length" class="field">
        <label>二维码内容</label>
        <div v-for="(code, i) in shotQr" :key="i" class="qr-item">
          <span class="qr-tag">[{{ code.type }}]</span>
          <span class="qr-data">{{ code.data }}</span>
          <button type="button" class="btn btn-sm" @click="copyQr(code.data)">复制</button>
        </div>
      </div>
      <div v-if="shotQrError" class="error-bar">{{ shotQrError }}</div>
      <p v-if="!shotDataUrl && !shotText && !shotError" class="hint">
        点击按钮后到屏幕上划选区域，即可识别其中的文字。
      </p>
    </section>

    <!-- 批量识别 -->
    <section v-if="activeTab === 'batch'" class="section">
      <div class="row">
        <button type="button" class="btn btn-primary" :disabled="running" @click="batchRun">
          {{ running ? '处理中…' : '选择图片' }}
        </button>
        <button type="button" class="btn" :disabled="batchItems.length === 0" @click="copyBatch">
          复制全部
        </button>
      </div>
      <div v-if="batchError" class="error-bar">{{ batchError }}</div>
      <div v-if="batchItems.length" class="result-list">
        <div v-for="(item, i) in batchItems" :key="i" class="result-item">
          <div class="result-head">
            <span class="file-name">{{ baseName(item.path) }}</span>
            <span v-if="item.error" class="badge badge-error">失败</span>
            <span v-else class="badge badge-ok">成功</span>
          </div>
          <pre v-if="!item.error" class="result-text">{{ item.text }}</pre>
          <div v-else class="error-bar">{{ item.error }}</div>
        </div>
      </div>
      <p v-if="!batchItems.length && !batchError" class="hint">
        一次选择多张图片，逐张提取文字。适用于连续截图、扫描件归档。
      </p>
    </section>

    <!-- PDF 识别 -->
    <section v-if="activeTab === 'pdf'" class="section">
      <div class="row">
        <button type="button" class="btn btn-primary" :disabled="running" @click="pdfRun">
          {{ running ? '处理中…' : '选择 PDF' }}
        </button>
        <button type="button" class="btn" :disabled="pdfPages.length === 0" @click="copyPdf">
          复制全部
        </button>
      </div>
      <div v-if="pdfError" class="error-bar">{{ pdfError }}</div>
      <div v-if="pdfPages.length" class="result-list">
        <div v-for="p in pdfPages" :key="p.page" class="result-item">
          <div class="result-head">
            <span class="file-name">{{ pdfName }} · 第 {{ p.page }} 页</span>
          </div>
          <pre class="result-text">{{ p.text }}</pre>
        </div>
      </div>
      <p v-if="!pdfPages.length && !pdfError" class="hint">
        适合扫描版 PDF 逐页提取文字；可选中复制的文字版 PDF 无需识别。
      </p>
    </section>

    <!-- 二维码识别 -->
    <section v-if="activeTab === 'qrcode'" class="section">
      <div class="row">
        <button type="button" class="btn btn-primary" :disabled="running" @click="qrRun">
          {{ running ? '处理中…' : '选择图片' }}
        </button>
      </div>
      <div v-if="qrError" class="error-bar">{{ qrError }}</div>
      <div v-if="qrCodes.length" class="qr-list">
        <div v-for="(code, i) in qrCodes" :key="i" class="qr-item">
          <span class="qr-tag">[{{ code.type }}]</span>
          <span class="qr-data">{{ code.data }}</span>
          <button type="button" class="btn btn-sm" @click="copyQr(code.data)">复制</button>
        </div>
      </div>
      <p v-if="!qrCodes.length && !qrError" class="hint">
        识别图片中的二维码与条形码，支持一张图多个码。
      </p>
    </section>
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

.tab-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}
.tab-btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  cursor: pointer;
  font-size: 13px;
}
.tab-btn.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}

.section h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #303133;
}
.field { margin-bottom: 12px; }
.field > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  resize: vertical;
  font-family: Consolas, monospace;
  white-space: pre-wrap;
}
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-primary { background: #409eff; border-color: #409eff; color: #fff; }
.btn:hover:not(:disabled) { border-color: #409eff; color: #409eff; }
.btn-primary:hover { color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-sm { height: 26px; padding: 0 10px; font-size: 12px; }

.scan-preview {
  margin: 8px 0 12px;
  max-height: 200px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #eee;
}
.scan-preview img {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  display: block;
  background: #fafafa;
}
.error-bar {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 6px;
  font-size: 13px;
}
.hint {
  margin: 4px 0;
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
}

.result-list { display: flex; flex-direction: column; gap: 10px; }
.result-item {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fafafa;
}
.result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.file-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.badge {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
}
.badge-ok { background: #f0f9eb; color: #67c23a; }
.badge-error { background: #fef0f0; color: #f56c6c; }
.result-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Consolas, monospace;
  color: #303133;
}

.qr-list { display: flex; flex-direction: column; gap: 8px; }
.qr-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafafa;
}
.qr-tag {
  flex-shrink: 0;
  font-size: 12px;
  color: #409eff;
  font-weight: 600;
}
.qr-data {
  flex: 1;
  font-size: 13px;
  color: #303133;
  word-break: break-all;
}
</style>