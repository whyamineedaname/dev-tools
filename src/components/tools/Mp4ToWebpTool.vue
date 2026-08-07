<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const sourceFile = ref('')
const targetDir = ref('')
const outputFileName = ref('')
const converting = ref(false)
const resultMsg = ref('')
const resultType = ref<'success' | 'error' | ''>('')

const fps = ref(12)
const maxWidth = ref(640)
const quality = ref(75)
const startSec = ref(0)
const durationSec = ref(0)

const ffmpegOk = ref(false)
const ffmpegInfo = ref('正在检测 FFmpeg…')

const canConvert = computed(() => {
  return !!sourceFile.value && !!targetDir.value && !!outputFileName.value && !converting.value && ffmpegOk.value
})

const outputPath = computed(() => {
  if (!targetDir.value || !outputFileName.value) return ''
  return `${targetDir.value}\\${outputFileName.value}`
})

onMounted(async () => {
  try {
    const result = await window.electronAPI.ffmpeg.check()
    ffmpegOk.value = result.available
    ffmpegInfo.value = result.available
      ? result.version
      : (result.error || '未检测到 FFmpeg')
  } catch (err) {
    ffmpegOk.value = false
    ffmpegInfo.value = err instanceof Error ? err.message : String(err)
  }
})

async function selectSourceFile() {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择 MP4 视频',
    filters: [
      { name: 'MP4 视频', extensions: ['mp4', 'm4v', 'mov'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (!path) return
  sourceFile.value = path
  const dir = path.substring(0, path.lastIndexOf('\\'))
  if (dir) targetDir.value = dir
  const name = path.split('\\').pop() || ''
  const nameWithoutExt = name.replace(/\.[^.]+$/, '')
  outputFileName.value = `${nameWithoutExt}.webp`
  resultMsg.value = ''
  resultType.value = ''
}

async function selectTargetDir() {
  const path = await window.electronAPI.dialog.openDirectory('选择输出目录')
  if (!path) return
  targetDir.value = path
  resultMsg.value = ''
  resultType.value = ''
}

async function startConvert() {
  if (!canConvert.value) return

  converting.value = true
  resultMsg.value = '正在转换中，请稍候…'
  resultType.value = ''

  try {
    const result = await window.electronAPI.ffmpeg.mp4ToWebp(
      sourceFile.value,
      outputPath.value,
      {
        fps: fps.value,
        maxWidth: maxWidth.value,
        quality: quality.value,
        startSec: startSec.value > 0 ? startSec.value : undefined,
        durationSec: durationSec.value > 0 ? durationSec.value : undefined
      }
    )
    if (result.success) {
      resultMsg.value = `转换成功！输出文件：${outputPath.value}`
      resultType.value = 'success'
    } else {
      resultMsg.value = `转换失败：${result.error || '未知错误'}`
      resultType.value = 'error'
    }
  } catch (e: unknown) {
    resultMsg.value = `调用失败：${e instanceof Error ? e.message : String(e)}`
    resultType.value = 'error'
  } finally {
    converting.value = false
  }
}
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="tool-title">MP4 转动图 WebP</h2>
      <p class="tool-desc">使用本机 FFmpeg 将视频转为循环播放的动图 WebP</p>

      <div class="ffmpeg-status" :class="{ ok: ffmpegOk, bad: !ffmpegOk }">
        <span class="label">FFmpeg：</span>
        <span class="value">{{ ffmpegInfo }}</span>
      </div>

      <div class="form-group">
        <label>源视频</label>
        <div class="file-picker">
          <input type="text" :value="sourceFile" readonly placeholder="请选择 MP4 文件">
          <button class="btn btn-primary" @click="selectSourceFile">选择文件</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出目录</label>
        <div class="file-picker">
          <input type="text" :value="targetDir" readonly placeholder="请选择输出目录">
          <button class="btn btn-primary" @click="selectTargetDir">选择目录</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出文件名</label>
        <input type="text" v-model="outputFileName" placeholder="例如：output.webp">
      </div>

      <div class="options-grid">
        <div class="form-group">
          <label>帧率 FPS（1–30）</label>
          <input v-model.number="fps" type="number" min="1" max="30" step="1">
        </div>
        <div class="form-group">
          <label>最大宽度（0=原宽）</label>
          <input v-model.number="maxWidth" type="number" min="0" max="3840" step="10">
        </div>
        <div class="form-group">
          <label>质量 0–100</label>
          <input v-model.number="quality" type="number" min="0" max="100" step="1">
        </div>
        <div class="form-group">
          <label>起始秒（可选）</label>
          <input v-model.number="startSec" type="number" min="0" step="0.1">
        </div>
        <div class="form-group">
          <label>截取时长秒（0=全部）</label>
          <input v-model.number="durationSec" type="number" min="0" step="0.1">
        </div>
      </div>

      <div v-if="outputPath" class="output-path">
        <span class="label">完整输出路径：</span>
        <span class="path">{{ outputPath }}</span>
      </div>

      <div class="tips">
        <p>提示：</p>
        <ul>
          <li>需本机已安装 FFmpeg，并确保命令行可执行 <code>ffmpeg</code></li>
          <li>帧率越低、宽度越小、质量越低，文件通常越小</li>
          <li>长视频建议设置「截取时长」，避免 WebP 过大</li>
        </ul>
      </div>

      <div class="action-bar">
        <button
          class="btn btn-primary btn-large"
          :disabled="!canConvert"
          @click="startConvert"
        >
          {{ converting ? '转换中…' : '开始转换' }}
        </button>
      </div>

      <div v-if="resultMsg" class="result-bar" :class="resultType">
        {{ resultMsg }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 40px;
}

.tool-card {
  width: 100%;
  max-width: 640px;
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.tool-title {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #333;
}

.tool-desc {
  font-size: 14px;
  color: #999;
  margin-bottom: 20px;
}

.ffmpeg-status {
  margin-bottom: 20px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  word-break: break-all;
}

.ffmpeg-status.ok {
  background: #f0f9eb;
  color: #67c23a;
}

.ffmpeg-status.bad {
  background: #fef0f0;
  color: #f56c6c;
}

.ffmpeg-status .label {
  font-weight: 600;
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 8px;
}

.form-group input[type="text"],
.form-group input[type="number"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-group input:focus {
  border-color: #ff7eb6;
  outline: none;
}

.file-picker {
  display: flex;
  gap: 10px;
}

.file-picker input {
  flex: 1;
  background: #f5f7fa;
}

.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}

.btn {
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #dcdfe6;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  color: #ff7eb6;
  border-color: #ffc2d9;
  background: #ffe8f1;
}

.btn-primary {
  background: #ff7eb6;
  border-color: #ff7eb6;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #ff5c9d;
  border-color: #ff5c9d;
  color: #fff;
}

.btn-large {
  padding: 12px 32px;
  font-size: 15px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.output-path {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
  word-break: break-all;
}

.output-path .label {
  color: #909399;
  margin-right: 8px;
}

.output-path .path {
  color: #606266;
  font-family: Consolas, monospace;
}

.tips {
  padding: 12px 16px;
  background: #fff3fa;
  border-radius: 6px;
  font-size: 13px;
  color: #e91e7e;
  margin-bottom: 20px;
}

.tips p {
  margin: 0 0 6px 0;
  font-weight: 500;
}

.tips ul {
  margin: 0;
  padding-left: 20px;
}

.tips li {
  margin-bottom: 4px;
}

.tips code {
  font-family: Consolas, monospace;
  background: rgba(255, 255, 255, 0.6);
  padding: 0 4px;
  border-radius: 3px;
}

.action-bar {
  margin-top: 24px;
  text-align: center;
}

.result-bar {
  margin-top: 20px;
  padding: 14px 16px;
  border-radius: 6px;
  font-size: 14px;
  word-break: break-all;
}

.result-bar.success {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #e1f3d8;
}

.result-bar.error {
  background: #fef0f0;
  color: #f56c6c;
  border: 1px solid #fbc4c4;
}

@media (max-width: 640px) {
  .options-grid {
    grid-template-columns: 1fr;
  }
}
</style>
