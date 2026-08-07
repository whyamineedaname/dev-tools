<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { removeBackground } from '@imgly/background-removal'

const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp']
const dragging = ref(false)
const processing = ref(false)
const progressText = ref('')
const errorMsg = ref('')
const sourceName = ref('')
const sourcePreview = ref('')
const resultPreview = ref('')
const resultBlob = ref<Blob | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const hasSource = computed(() => !!sourcePreview.value)
const hasResult = computed(() => !!resultPreview.value)
const canRemove = computed(() => hasSource.value && !processing.value)

function revoke(url: string) {
  if (url) URL.revokeObjectURL(url)
}

function resetResult() {
  revoke(resultPreview.value)
  resultPreview.value = ''
  resultBlob.value = null
}

function clearAll() {
  revoke(sourcePreview.value)
  sourcePreview.value = ''
  sourceName.value = ''
  resetResult()
  errorMsg.value = ''
  progressText.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function isAcceptedFile(file: File): boolean {
  if (ACCEPTED.includes(file.type)) return true
  const ext = file.name.split('.').pop()?.toLowerCase()
  return !!ext && ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)
}

function loadFile(file: File) {
  if (!isAcceptedFile(file)) {
    errorMsg.value = '请选择 PNG / JPG / WEBP / BMP 图片'
    return
  }
  errorMsg.value = ''
  resetResult()
  revoke(sourcePreview.value)
  sourceName.value = file.name
  sourcePreview.value = URL.createObjectURL(file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) loadFile(file)
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) loadFile(file)
}

async function startRemove() {
  if (!canRemove.value || !sourcePreview.value) return
  processing.value = true
  errorMsg.value = ''
  progressText.value = '准备模型…'
  resetResult()
  try {
    const response = await fetch(sourcePreview.value)
    const blob = await response.blob()
    const out = await removeBackground(blob, {
      model: 'isnet_fp16',
      output: { format: 'image/png', quality: 0.9 },
      progress: (key, current, total) => {
        if (!total) {
          progressText.value = '处理中…'
          return
        }
        const pct = Math.min(100, Math.round((current / total) * 100))
        progressText.value = key.includes('fetch') || key.includes('download')
          ? `下载模型 ${pct}%（首次需联网）`
          : `去背景中 ${pct}%`
      }
    })
    resultBlob.value = out
    resultPreview.value = URL.createObjectURL(out)
    progressText.value = '完成'
  } catch (err) {
    errorMsg.value = `去背景失败：${err instanceof Error ? err.message : String(err)}`
    progressText.value = ''
  } finally {
    processing.value = false
  }
}

function defaultExportName(): string {
  return `${sourceName.value.replace(/\.[^.]+$/, '') || 'image'}-no-bg.png`
}

async function saveResult() {
  if (!resultBlob.value) return
  errorMsg.value = ''
  try {
    const bytes = new Uint8Array(await resultBlob.value.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const base64 = btoa(binary)
    if (window.electronAPI?.file?.writeBase64 && window.electronAPI?.dialog?.saveFile) {
      const savePath = await window.electronAPI.dialog.saveFile({
        title: '保存去背景图片',
        defaultPath: defaultExportName(),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      })
      if (!savePath) return
      const result = await window.electronAPI.file.writeBase64(savePath, base64)
      if (!result.success) errorMsg.value = result.error || '保存失败'
      return
    }
    const a = document.createElement('a')
    a.href = resultPreview.value
    a.download = defaultExportName()
    a.click()
  } catch (err) {
    errorMsg.value = `保存失败：${err instanceof Error ? err.message : String(err)}`
  }
}

onBeforeUnmount(() => clearAll())
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="title">图片去背景</h2>
      <p class="desc">拖拽或选择图片预览，一键去除背景（本地 AI 处理，首次需下载模型）</p>
      <input
        ref="fileInputRef"
        class="hidden-input"
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
        @change="onFileChange"
      >
      <div
        class="dropzone"
        :class="{ dragging, filled: hasSource }"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @click="openFilePicker"
      >
        <template v-if="!hasSource">
          <div class="drop-icon">IMG</div>
          <div class="drop-title">拖拽图片到此处</div>
          <div class="drop-hint">或点击选择文件 · PNG / JPG / WEBP / BMP</div>
        </template>
        <template v-else>
          <div class="preview-grid" @click.stop>
            <div class="preview-panel">
              <div class="preview-label">原图</div>
              <div class="preview-frame">
                <img :src="sourcePreview" :alt="sourceName">
              </div>
              <div class="file-name" :title="sourceName">{{ sourceName }}</div>
            </div>
            <div class="preview-panel">
              <div class="preview-label">去背景结果</div>
              <div class="preview-frame checker">
                <img v-if="hasResult" :src="resultPreview" alt="result">
                <div v-else class="placeholder">{{ processing ? '处理中…' : '点击下方按钮生成' }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>
      <div class="actions">
        <button class="btn" :disabled="processing" @click.stop="openFilePicker">{{ hasSource ? '更换图片' : '选择图片' }}</button>
        <button class="btn btn-primary" :disabled="!canRemove" @click.stop="startRemove">{{ processing ? '去背景中…' : '一键去背景' }}</button>
        <button class="btn btn-success" :disabled="!hasResult || processing" @click.stop="saveResult">保存 PNG</button>
        <button v-if="hasSource" class="btn btn-ghost" :disabled="processing" @click.stop="clearAll">清空</button>
      </div>
      <div v-if="progressText && (processing || hasResult)" class="progress">{{ progressText }}</div>
      <div v-if="errorMsg" class="result-bar error">{{ errorMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.tool-page { height: 100%; display: flex; justify-content: center; align-items: flex-start; padding-top: 24px; }
.tool-card { width: 100%; max-width: 860px; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
.title { font-size: 20px; font-weight: 600; color: #303133; margin-bottom: 8px; }
.desc { color: #909399; font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
.hidden-input { display: none; }
.dropzone { border: 2px dashed #f3c4d6; border-radius: 12px; background: #fff7fa; min-height: 220px; padding: 20px; cursor: pointer; transition: border-color .2s, background .2s; }
.dropzone:hover, .dropzone.dragging { border-color: #ff7eb6; background: #ffe8f1; }
.dropzone.filled { cursor: default; background: #fff; }
.drop-icon { font-size: 28px; font-weight: 700; text-align: center; margin-top: 28px; margin-bottom: 10px; color: #ff7eb6; }
.drop-title { text-align: center; font-size: 16px; font-weight: 600; color: #c4567a; }
.drop-hint { text-align: center; margin-top: 8px; font-size: 12px; color: #909399; }
.preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.preview-panel { min-width: 0; }
.preview-label { font-size: 12px; font-weight: 600; color: #909399; margin-bottom: 8px; }
.preview-frame { height: 260px; border-radius: 10px; border: 1px solid #f0f0f0; background: #fafafa; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.preview-frame.checker { background-color: #f5f5f5; background-image: linear-gradient(45deg,#e8e8e8 25%,transparent 25%),linear-gradient(-45deg,#e8e8e8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e8e8e8 75%),linear-gradient(-45deg,transparent 75%,#e8e8e8 75%); background-size: 16px 16px; background-position: 0 0,0 8px,8px -8px,-8px 0; }
.preview-frame img { max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; }
.placeholder { color: #909399; font-size: 13px; padding: 12px; text-align: center; }
.file-name { margin-top: 8px; font-size: 12px; color: #606266; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.btn { padding: 10px 16px; border-radius: 6px; font-size: 13px; background: #ffe8f1; color: #c4567a; }
.btn:hover:not(:disabled) { background: #ffd6e7; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn-primary { background: #ff7eb6; color: #fff; }
.btn-primary:hover:not(:disabled) { background: #ff5c9d; }
.btn-success { background: #67c23a; color: #fff; }
.btn-success:hover:not(:disabled) { background: #5daf34; }
.btn-ghost { background: #f5f7fa; color: #606266; }
.progress { margin-top: 14px; font-size: 13px; color: #c4567a; }
.result-bar { margin-top: 14px; padding: 10px 14px; border-radius: 6px; font-size: 13px; }
.result-bar.error { background: #fef0f0; color: #f56c6c; }
@media (max-width: 720px) { .preview-grid { grid-template-columns: 1fr; } .preview-frame { height: 200px; } }
</style>
