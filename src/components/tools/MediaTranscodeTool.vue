<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type Mode = 'toMp3' | 'extractAudio' | 'compressVideo'

const mode = ref<Mode>('toMp3')
const sourceFile = ref('')
const targetDir = ref('')
const outputFileName = ref('')
const converting = ref(false)
const resultMsg = ref('')
const resultType = ref<'success' | 'error' | ''>('')

const audioBitrate = ref('192k')
const audioCodec = ref<'mp3' | 'aac' | 'wav' | 'copy'>('mp3')
const videoCrf = ref(28)
const maxWidth = ref(1280)
const startSec = ref(0)
const durationSec = ref(0)

const ffmpegOk = ref(false)
const ffmpegInfo = ref('正在检测 FFmpeg…')

const modeOptions: { id: Mode; label: string; desc: string }[] = [
  { id: 'toMp3', label: '转 MP3', desc: '视频/音频 → MP3' },
  { id: 'extractAudio', label: '抽音频', desc: '仅导出音轨' },
  { id: 'compressVideo', label: '压视频', desc: 'H.264 压缩' }
]

const canConvert = computed(
  () =>
    !!sourceFile.value &&
    !!targetDir.value &&
    !!outputFileName.value &&
    !converting.value &&
    ffmpegOk.value
)

const outputPath = computed(() => {
  if (!targetDir.value || !outputFileName.value) return ''
  return `${targetDir.value}\\${outputFileName.value}`
})

function defaultExt(m: Mode): string {
  if (m === 'compressVideo') return 'mp4'
  if (m === 'extractAudio') {
    if (audioCodec.value === 'wav') return 'wav'
    if (audioCodec.value === 'aac') return 'm4a'
    if (audioCodec.value === 'copy') return 'm4a'
    return 'mp3'
  }
  return 'mp3'
}

function syncOutputName() {
  if (!sourceFile.value) return
  const name = sourceFile.value.split(/[/\\]/).pop() || 'output'
  const base = name.replace(/\.[^.]+$/, '')
  outputFileName.value = `${base}.${defaultExt(mode.value)}`
}

onMounted(async () => {
  try {
    const result = await window.electronAPI.ffmpeg.check()
    ffmpegOk.value = result.available
    ffmpegInfo.value = result.available ? result.version : result.error || '未检测到 FFmpeg'
  } catch (err) {
    ffmpegOk.value = false
    ffmpegInfo.value = err instanceof Error ? err.message : String(err)
  }
})

async function selectSourceFile() {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择音视频文件',
    filters: [
      {
        name: '媒体文件',
        extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'flac']
      },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (!path) return
  sourceFile.value = path
  const dir = path.substring(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')))
  if (dir) targetDir.value = dir
  syncOutputName()
  resultMsg.value = ''
  resultType.value = ''
}

async function selectTargetDir() {
  const path = await window.electronAPI.dialog.openDirectory('选择输出目录')
  if (!path) return
  targetDir.value = path
}

async function startConvert() {
  if (!canConvert.value) return
  converting.value = true
  resultMsg.value = '正在转换中，请稍候…'
  resultType.value = ''
  try {
    const result = await window.electronAPI.ffmpeg.transcode(
      sourceFile.value,
      outputPath.value,
      {
        mode: mode.value,
        audioBitrate: audioBitrate.value,
        audioCodec: audioCodec.value,
        videoCrf: videoCrf.value,
        maxWidth: maxWidth.value,
        startSec: startSec.value > 0 ? startSec.value : undefined,
        durationSec: durationSec.value > 0 ? durationSec.value : undefined
      }
    )
    if (result.success) {
      resultMsg.value = `转换成功：${outputPath.value}`
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

function onModeChange(m: Mode) {
  mode.value = m
  if (m === 'toMp3') audioCodec.value = 'mp3'
  syncOutputName()
}
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="tool-title">音视频转码</h2>
      <p class="tool-desc">基于本机 FFmpeg：转 MP3、抽取音频、压缩视频</p>

      <div class="ffmpeg-status" :class="{ ok: ffmpegOk, bad: !ffmpegOk }">
        <span class="label">FFmpeg：</span>
        <span class="value">{{ ffmpegInfo }}</span>
      </div>

      <div class="modes">
        <button
          v-for="m in modeOptions"
          :key="m.id"
          type="button"
          class="mode-btn"
          :class="{ active: mode === m.id }"
          @click="onModeChange(m.id)"
        >
          <strong>{{ m.label }}</strong>
          <span>{{ m.desc }}</span>
        </button>
      </div>

      <div class="form-group">
        <label>源文件</label>
        <div class="file-picker">
          <input type="text" :value="sourceFile" readonly placeholder="请选择音视频文件" />
          <button type="button" class="btn btn-primary" @click="selectSourceFile">选择文件</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出目录</label>
        <div class="file-picker">
          <input type="text" :value="targetDir" readonly placeholder="请选择输出目录" />
          <button type="button" class="btn" @click="selectTargetDir">选择目录</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出文件名</label>
        <input v-model="outputFileName" type="text" class="text-input" placeholder="例如：output.mp3" />
      </div>

      <div class="options">
        <label v-if="mode !== 'compressVideo'" class="opt">
          音码率
          <select v-model="audioBitrate">
            <option value="128k">128k</option>
            <option value="192k">192k</option>
            <option value="256k">256k</option>
            <option value="320k">320k</option>
          </select>
        </label>
        <label v-if="mode === 'extractAudio'" class="opt">
          音频格式
          <select v-model="audioCodec" @change="syncOutputName">
            <option value="mp3">MP3</option>
            <option value="aac">AAC</option>
            <option value="wav">WAV</option>
            <option value="copy">原样拷贝</option>
          </select>
        </label>
        <label v-if="mode === 'compressVideo'" class="opt">
          CRF 质量
          <input v-model.number="videoCrf" type="number" min="16" max="40" />
        </label>
        <label v-if="mode === 'compressVideo'" class="opt">
          最大宽
          <input v-model.number="maxWidth" type="number" min="0" max="3840" step="16" />
        </label>
        <label class="opt">
          起始秒
          <input v-model.number="startSec" type="number" min="0" step="0.1" />
        </label>
        <label class="opt">
          时长秒
          <input v-model.number="durationSec" type="number" min="0" step="0.1" />
        </label>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-primary" :disabled="!canConvert" @click="startConvert">
          {{ converting ? '转换中…' : '开始转换' }}
        </button>
      </div>

      <div v-if="resultMsg" class="result" :class="resultType">{{ resultMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.tool-page { height: 100%; }
.tool-card {
  background: #fff;
  border-radius: 8px;
  padding: 18px 20px 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.tool-title { margin: 0 0 6px; font-size: 18px; color: #303133; }
.tool-desc { margin: 0 0 14px; font-size: 13px; color: #909399; }
.ffmpeg-status {
  margin-bottom: 14px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.ffmpeg-status.ok { background: #f0f9eb; color: #67c23a; }
.ffmpeg-status.bad { background: #fef0f0; color: #f56c6c; }
.modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}
.mode-btn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  text-align: left;
}
.mode-btn strong { font-size: 14px; color: #303133; }
.mode-btn span { font-size: 12px; color: #909399; }
.mode-btn.active {
  border-color: #ff7eb6;
  background: #fff5f8;
}
.form-group { margin-bottom: 12px; }
.form-group > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.file-picker { display: flex; gap: 8px; }
.file-picker input, .text-input {
  flex: 1;
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  box-sizing: border-box;
  width: 100%;
}
.btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.btn-primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.options {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin: 12px 0 16px;
}
.opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}
.opt input, .opt select {
  height: 30px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
  width: 88px;
}
.actions { margin-bottom: 12px; }
.result {
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
  word-break: break-all;
}
.result.success { background: #f0f9eb; color: #67c23a; }
.result.error { background: #fef0f0; color: #f56c6c; }
@media (max-width: 900px) {
  .modes { grid-template-columns: 1fr; }
}
</style>
