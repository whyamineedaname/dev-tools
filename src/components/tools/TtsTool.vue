<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TtsVoice } from '@/types/tts'

const voices = ref<TtsVoice[]>([])
const selectedId = ref('')
const envMsg = ref('正在检测环境…')
const envOk = ref(false)
const modelReady = ref(false)
const importOk = ref(false)
const ffmpegOk = ref(false)
const busy = ref(false)
const progressMsg = ref('')
const resultMsg = ref('')
const resultType = ref<'success' | 'error' | ''>('')

const text = ref('')
const outputDir = ref('')
const fileName = ref('')
const format = ref<'wav' | 'mp3'>('wav')
const overwrite = ref(false)

const showImport = ref(false)
const importPath = ref('')
const importName = ref('')
const importTranscript = ref('')
const importNote = ref('')

const showEdit = ref(false)
const editName = ref('')
const editTranscript = ref('')
const editNote = ref('')

const lastOutputPath = ref('')
let audioUrl = ''
const playingId = ref('')
let offProgress: (() => void) | null = null

const selected = computed(() => voices.value.find((v) => v.id === selectedId.value) || null)
const mutexBusy = computed(() => busy.value)

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function defaultFileName(fmt: 'wav' | 'mp3'): string {
  const d = new Date()
  return `tts-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${fmt}`
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${s} 秒`
}

function revokeAudio(): void {
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl)
    audioUrl = ''
  }
  playingId.value = ''
}

function setError(msg: string): void {
  resultMsg.value = msg
  resultType.value = 'error'
}

function setOk(msg: string): void {
  resultMsg.value = msg
  resultType.value = 'success'
}

async function refreshList(): Promise<void> {
  const res = await window.electronAPI.tts.list()
  if (!res.success) {
    setError(res.error)
    return
  }
  voices.value = res.voices
  if (selectedId.value && !voices.value.some((v) => v.id === selectedId.value)) {
    selectedId.value = ''
    showEdit.value = false
  }
}

async function probe(): Promise<void> {
  const res = await window.electronAPI.tts.probe()
  if (!res.success) {
    envOk.value = false
    envMsg.value = res.error
    if (res.lastOutputDir) outputDir.value = res.lastOutputDir
    if (res.ffmpegOk != null) ffmpegOk.value = res.ffmpegOk
    return
  }
  envOk.value = true
  modelReady.value = res.modelReady
  importOk.value = res.cosyvoiceImportOk
  ffmpegOk.value = res.ffmpegOk
  envMsg.value = res.message
  outputDir.value = res.lastOutputDir
  if (!fileName.value) fileName.value = defaultFileName(format.value)
}

watch(format, (fmt) => {
  const cur = fileName.value
  const stem = cur.replace(/\.(wav|mp3)$/i, '')
  fileName.value = `${stem || defaultFileName(fmt).replace(/\.(wav|mp3)$/i, '')}.${fmt}`
})

async function downloadModel(): Promise<void> {
  if (mutexBusy.value) return
  busy.value = true
  progressMsg.value = '下载模型…'
  resultMsg.value = ''
  try {
    const res = await window.electronAPI.tts.downloadModel()
    if (!res.success) setError(res.error || '下载失败')
    else {
      setOk('模型已就绪')
      await probe()
    }
  } finally {
    busy.value = false
    progressMsg.value = ''
  }
}

async function pickImportFile(): Promise<void> {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择参考音频（3～30 秒）',
    filters: [{ name: '音频', extensions: ['wav', 'mp3', 'm4a', 'flac'] }]
  })
  if (path) importPath.value = path
}

async function doImport(): Promise<void> {
  if (mutexBusy.value) return
  busy.value = true
  resultMsg.value = ''
  try {
    const res = await window.electronAPI.tts.import({
      name: importName.value,
      sourcePath: importPath.value,
      transcript: importTranscript.value,
      note: importNote.value
    })
    if (!res.success) {
      setError(res.error)
      return
    }
    showImport.value = false
    importPath.value = ''
    importName.value = ''
    importTranscript.value = ''
    importNote.value = ''
    await refreshList()
    selectedId.value = res.voice.id
    setOk('已加入音色库')
  } finally {
    busy.value = false
  }
}

function openEdit(): void {
  if (!selected.value) return
  editName.value = selected.value.name
  editTranscript.value = selected.value.transcript
  editNote.value = selected.value.note
  showEdit.value = true
}

async function doUpdate(): Promise<void> {
  if (!selected.value || mutexBusy.value) return
  busy.value = true
  try {
    const res = await window.electronAPI.tts.update({
      id: selected.value.id,
      name: editName.value,
      transcript: editTranscript.value,
      note: editNote.value
    })
    if (!res.success) setError(res.error || '保存失败')
    else {
      showEdit.value = false
      await refreshList()
      setOk('已保存')
    }
  } finally {
    busy.value = false
  }
}

async function doDelete(id: string): Promise<void> {
  if (mutexBusy.value) return
  busy.value = true
  try {
    const res = await window.electronAPI.tts.delete(id)
    if (!res.success) setError(res.error || '删除失败')
    else {
      revokeAudio()
      await refreshList()
      setOk('已删除')
    }
  } finally {
    busy.value = false
  }
}

async function playRef(id: string): Promise<void> {
  revokeAudio()
  const res = await window.electronAPI.tts.readRef(id)
  if (!res.success) {
    setError(res.error)
    return
  }
  const binary = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))
  const blob = new Blob([binary], { type: res.mime })
  audioUrl = URL.createObjectURL(blob)
  playingId.value = id
  const el = document.getElementById('tts-ref-audio') as HTMLAudioElement | null
  if (el) {
    el.src = audioUrl
    void el.play()
  }
}

async function pickOutputDir(): Promise<void> {
  const path = await window.electronAPI.dialog.openDirectory('选择输出目录')
  if (!path) return
  const res = await window.electronAPI.tts.setOutputDir(path)
  if (res.success) outputDir.value = res.lastOutputDir
  else setError(res.error)
}

async function synthesize(): Promise<void> {
  if (!selected.value || mutexBusy.value) return
  if (selected.value.missingFile) {
    setError('参考音频缺失，请删除后重新导入')
    return
  }
  busy.value = true
  progressMsg.value = '合成中…'
  resultMsg.value = ''
  lastOutputPath.value = ''
  try {
    const res = await window.electronAPI.tts.synthesize({
      voiceId: selected.value.id,
      text: text.value,
      outputDir: outputDir.value,
      fileName: fileName.value,
      format: format.value,
      overwrite: overwrite.value
    })
    if (!res.success) setError(res.error)
    else {
      lastOutputPath.value = res.outputPath
      setOk(`已导出：${res.outputPath}`)
      fileName.value = defaultFileName(format.value)
    }
  } finally {
    busy.value = false
    progressMsg.value = ''
  }
}

async function revealOutput(): Promise<void> {
  if (!outputDir.value) return
  await window.electronAPI.shell.openPath(outputDir.value)
}

onMounted(async () => {
  offProgress = window.electronAPI.tts.onProgress((p) => {
    progressMsg.value = p.message || p.phase
  })
  await probe()
  await refreshList()
})

onBeforeUnmount(() => {
  offProgress?.()
  offProgress = null
  revokeAudio()
  void window.electronAPI.tts.stopWorker()
})
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="tool-title">语音合成</h2>
      <p class="tool-desc">
        本地私人音色库：导入自己的参考录音后合成语音。只使用你拥有或已获授权的声音；克隆他人声音可能违法。引擎为 CosyVoice（Apache 2.0），模型需本机下载，不上传音频。
      </p>

      <div class="env-bar" :class="{ ok: envOk, bad: !envOk }">
        {{ envMsg }}
      </div>
      <div class="env-actions">
        <button
          v-if="envOk && importOk && !modelReady"
          type="button"
          class="btn btn-primary"
          :disabled="busy"
          @click="downloadModel"
        >
          下载模型
        </button>
        <span v-if="envOk && modelReady" class="hint">模型已就绪</span>
        <span v-if="!ffmpegOk" class="hint warn">导入参考音需要 FFmpeg</span>
      </div>

      <div class="layout">
        <div class="col left">
          <div class="col-head">
            <strong>音色库</strong>
            <button type="button" class="btn" :disabled="busy" @click="showImport = true">导入</button>
          </div>
          <ul class="voice-list">
            <li
              v-for="v in voices"
              :key="v.id"
              class="voice-item"
              :class="{ active: v.id === selectedId, missing: v.missingFile }"
              @click="selectedId = v.id"
            >
              <div class="voice-name">{{ v.name }}</div>
              <div class="voice-meta">
                {{ formatDuration(v.durationMs) }}
                <span v-if="v.missingFile"> · 文件缺失</span>
              </div>
              <div class="voice-ops">
                <button type="button" class="link" :disabled="busy || !!v.missingFile" @click.stop="playRef(v.id)">
                  试听
                </button>
                <button type="button" class="link danger" :disabled="busy" @click.stop="doDelete(v.id)">删除</button>
              </div>
            </li>
            <li v-if="!voices.length" class="empty">还没有音色，请导入 3～30 秒参考音频</li>
          </ul>
          <audio id="tts-ref-audio" class="hidden-audio" controls />
        </div>

        <div class="col right">
          <div class="form-group">
            <label>当前音色</label>
            <div class="current">
              {{ selected ? selected.name : '请在左侧选择' }}
              <button v-if="selected" type="button" class="btn" :disabled="busy" @click="openEdit">重命名 / 转写</button>
            </div>
          </div>
          <div class="form-group">
            <label>合成文本</label>
            <textarea v-model="text" rows="6" maxlength="2000" :disabled="busy" placeholder="输入要朗读的文字（最多 2000 字）" />
          </div>
          <div class="form-group">
            <label>输出目录</label>
            <div class="file-picker">
              <input type="text" :value="outputDir" readonly />
              <button type="button" class="btn" :disabled="busy" @click="pickOutputDir">选择目录</button>
            </div>
          </div>
          <div class="form-group">
            <label>文件名</label>
            <input v-model="fileName" type="text" :disabled="busy" />
          </div>
          <div class="form-group row">
            <label class="radio">
              <input v-model="format" type="radio" value="wav" :disabled="busy" />
              WAV
            </label>
            <label class="radio">
              <input v-model="format" type="radio" value="mp3" :disabled="busy" />
              MP3
            </label>
            <label class="checkbox-label">
              <input v-model="overwrite" type="checkbox" :disabled="busy" />
              覆盖已存在文件
            </label>
          </div>
          <div class="actions">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="busy || !selected || !text.trim() || !outputDir || selected.missingFile"
              @click="synthesize"
            >
              开始合成
            </button>
            <button v-if="lastOutputPath" type="button" class="btn" @click="revealOutput">打开文件位置</button>
          </div>
          <div v-if="progressMsg && busy" class="progress-text">{{ progressMsg }}</div>
        </div>
      </div>

      <div v-if="showImport" class="panel">
        <h3>导入音色</h3>
        <p class="warn-text">请只导入你自己的录音，或已获得授权的音频。</p>
        <div class="form-group">
          <label>参考音频</label>
          <div class="file-picker">
            <input type="text" :value="importPath" readonly placeholder="wav / mp3 / m4a / flac" />
            <button type="button" class="btn" @click="pickImportFile">选择</button>
          </div>
        </div>
        <div class="form-group">
          <label>名称</label>
          <input v-model="importName" type="text" maxlength="64" />
        </div>
        <div class="form-group">
          <label>转写（音频里说的内容，必填）</label>
          <textarea v-model="importTranscript" rows="3" maxlength="500" />
        </div>
        <div class="form-group">
          <label>备注（选填）</label>
          <input v-model="importNote" type="text" maxlength="200" />
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="doImport">保存</button>
          <button type="button" class="btn" @click="showImport = false">取消</button>
        </div>
      </div>

      <div v-if="showEdit && selected" class="panel">
        <h3>编辑音色</h3>
        <div class="form-group">
          <label>名称</label>
          <input v-model="editName" type="text" maxlength="64" />
        </div>
        <div class="form-group">
          <label>转写</label>
          <textarea v-model="editTranscript" rows="3" maxlength="500" />
        </div>
        <div class="form-group">
          <label>备注</label>
          <input v-model="editNote" type="text" maxlength="200" />
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="doUpdate">保存</button>
          <button type="button" class="btn" @click="showEdit = false">取消</button>
        </div>
      </div>

      <div v-if="resultMsg" class="result" :class="resultType">{{ resultMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.tool-page { height: 100%; overflow: auto; }
.tool-card {
  background: #fff;
  border-radius: 8px;
  padding: 18px 20px 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.tool-title { margin: 0 0 6px; font-size: 18px; color: #303133; }
.tool-desc { margin: 0 0 12px; font-size: 13px; color: #909399; line-height: 1.5; }
.env-bar {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 8px;
}
.env-bar.ok { background: #f0f9eb; color: #67c23a; }
.env-bar.bad { background: #fef0f0; color: #f56c6c; }
.env-actions { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.hint { font-size: 12px; color: #67c23a; }
.hint.warn { color: #e6a23c; }
.layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; }
.col-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.voice-list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; }
.voice-item {
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
}
.voice-item.active { border-color: #ff7eb6; background: #fff5f8; }
.voice-item.missing { opacity: 0.7; }
.voice-name { font-size: 14px; color: #303133; }
.voice-meta { font-size: 12px; color: #909399; margin: 4px 0; }
.voice-ops { display: flex; gap: 8px; }
.link { font-size: 12px; color: #ff7eb6; background: none; border: none; padding: 0; cursor: pointer; }
.link.danger { color: #f56c6c; }
.empty { font-size: 12px; color: #909399; padding: 12px 0; }
.hidden-audio { width: 100%; margin-top: 8px; height: 32px; }
.form-group { margin-bottom: 12px; }
.form-group > label { display: block; margin-bottom: 6px; font-size: 13px; color: #606266; }
.form-group textarea, .form-group input[type='text'] {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  box-sizing: border-box;
}
.file-picker { display: flex; gap: 8px; }
.file-picker input { flex: 1; height: 34px; border: 1px solid #dcdfe6; border-radius: 6px; padding: 0 10px; background: #f5f7fa; }
.current { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.row { display: flex; align-items: center; gap: 16px; }
.radio, .checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #606266; }
.btn {
  height: 34px; padding: 0 12px; border: 1px solid #dcdfe6; border-radius: 6px; background: #fff; font-size: 13px;
}
.btn-primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.actions { display: flex; gap: 8px; margin-bottom: 8px; }
.progress-text { font-size: 12px; color: #909399; }
.panel {
  margin-top: 16px; padding: 12px; border: 1px dashed #ffc2d9; border-radius: 8px; background: #fffafc;
}
.panel h3 { margin: 0 0 8px; font-size: 15px; }
.warn-text { font-size: 12px; color: #e6a23c; margin: 0 0 10px; }
.result { margin-top: 12px; font-size: 13px; }
.result.success { color: #67c23a; }
.result.error { color: #f56c6c; }
</style>
