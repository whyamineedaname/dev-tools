<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const text = ref('https://example.com')
const size = ref(256)
const ecLevel = ref<'L' | 'M' | 'Q' | 'H'>('M')
const dataUrl = ref('')
const genError = ref('')

const scanResult = ref('')
const scanError = ref('')
const scanPreview = ref('')

async function generate() {
  genError.value = ''
  try {
    if (!text.value.trim()) {
      genError.value = '请输入要编码的内容'
      dataUrl.value = ''
      return
    }
    dataUrl.value = await QRCode.toDataURL(text.value, {
      width: size.value,
      margin: 2,
      errorCorrectionLevel: ecLevel.value,
      color: { dark: '#303133', light: '#ffffff' }
    })
  } catch (e: unknown) {
    genError.value = e instanceof Error ? e.message : String(e)
    dataUrl.value = ''
  }
}

async function downloadPng() {
  if (!dataUrl.value) return
  const path = await window.electronAPI.dialog.saveFile({
    title: '保存二维码',
    defaultPath: 'qrcode.png',
    filters: [{ name: 'PNG', extensions: ['png'] }]
  })
  if (!path) return
  const base64 = dataUrl.value.replace(/^data:image\/png;base64,/, '')
  const result = await window.electronAPI.file.writeBase64(path, base64)
  if (!result.success) genError.value = result.error || '保存失败'
}

async function copyImage() {
  if (!dataUrl.value) return
  const res = await fetch(dataUrl.value)
  const blob = await res.blob()
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  void decodeFile(file)
  input.value = ''
}

async function pickImage() {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择含二维码的图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
  })
  if (!path) return
  const result = await window.electronAPI.file.readBinary(path)
  if (!result.success || !result.base64) {
    scanError.value = result.error || '读取失败'
    return
  }
  const mime = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  const url = `data:${mime};base64,${result.base64}`
  await decodeDataUrl(url)
}

async function decodeFile(file: File) {
  const url = URL.createObjectURL(file)
  try {
    await decodeDataUrl(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function decodeDataUrl(url: string) {
  scanError.value = ''
  scanResult.value = ''
  scanPreview.value = url
  const img = new Image()
  img.src = url
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片加载失败'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    scanError.value = '无法创建画布'
    return
  }
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(imageData.data, imageData.width, imageData.height)
  if (!code) {
    scanError.value = '未识别到二维码'
    return
  }
  scanResult.value = code.data
}

async function copyScan() {
  if (!scanResult.value) return
  await navigator.clipboard.writeText(scanResult.value)
}

void generate()
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>二维码</h2>
      <p>本地生成二维码，或从图片识别内容</p>
    </div>

    <div class="grid-2">
      <section class="section">
        <h3>生成</h3>
        <div class="field">
          <label>内容</label>
          <textarea v-model="text" class="textarea" rows="4" placeholder="链接或任意文本" @input="generate" />
        </div>
        <div class="row">
          <label class="inline">
            尺寸
            <input v-model.number="size" class="num" type="number" min="128" max="1024" step="32" @change="generate" />
          </label>
          <label class="inline">
            纠错
            <select v-model="ecLevel" class="select" @change="generate">
              <option value="L">L</option>
              <option value="M">M</option>
              <option value="Q">Q</option>
              <option value="H">H</option>
            </select>
          </label>
          <button type="button" class="btn btn-primary" @click="generate">生成</button>
        </div>
        <div v-if="genError" class="error-bar">{{ genError }}</div>
        <div v-if="dataUrl" class="qr-box">
          <img :src="dataUrl" alt="二维码" />
          <div class="row">
            <button type="button" class="btn" @click="downloadPng">保存 PNG</button>
            <button type="button" class="btn" @click="copyImage">复制图片</button>
          </div>
        </div>
      </section>

      <section class="section">
        <h3>识别</h3>
        <div class="row">
          <button type="button" class="btn btn-primary" @click="pickImage">选择图片</button>
          <label class="btn file-btn">
            本地上传
            <input type="file" accept="image/*" hidden @change="onFileChange" />
          </label>
        </div>
        <div v-if="scanError" class="error-bar">{{ scanError }}</div>
        <div v-if="scanPreview" class="scan-preview">
          <img :src="scanPreview" alt="预览" />
        </div>
        <div class="field">
          <label>识别结果</label>
          <textarea class="textarea" rows="4" readonly :value="scanResult" placeholder="识别结果…" />
          <button type="button" class="btn" :disabled="!scanResult" @click="copyScan">复制结果</button>
        </div>
      </section>
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
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
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
}
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.inline {
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
.num { width: 88px; }
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
.qr-box {
  margin-top: 8px;
  padding: 12px;
  border: 1px dashed #f2d7e2;
  border-radius: 8px;
  text-align: center;
  background: #fffafc;
}
.qr-box img { width: 220px; height: 220px; object-fit: contain; margin-bottom: 10px; }
.scan-preview {
  margin: 8px 0 12px;
  max-height: 180px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #eee;
}
.scan-preview img { width: 100%; max-height: 180px; object-fit: contain; display: block; background: #fafafa; }
.error-bar {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 6px;
  font-size: 13px;
}
@media (max-width: 900px) {
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
