<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

type Mode = '2stem' | '4stem'

const mode = ref<Mode>('2stem')
const sourceFile = ref('')
const targetDir = ref('')
const toMp3 = ref(false)
const running = ref(false)
const progressPercent = ref(0)
const progressMsg = ref('')
const resultMsg = ref('')
const resultType = ref<'success' | 'error' | ''>('')
const outputFiles = ref<{ name: string; path: string; label: string }[]>([])
const outputDir = ref('')

let unsubscribe: (() => void) | null = null

const canStart = computed(() => !!sourceFile.value && !!targetDir.value && !running.value)

const modeOptions: { id: Mode; label: string; desc: string }[] = [
  { id: '2stem', label: '人声 + 伴奏', desc: '分离成人声与伴奏两轨' },
  { id: '4stem', label: '四轨分离', desc: '人声 / 鼓 / 贝斯 / 其他' }
]

async function selectSourceFile() {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择音频文件',
    filters: [
      {
        name: '音频文件',
        extensions: ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'aac', 'opus']
      },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (!path) return
  sourceFile.value = path
  const dir = path.substring(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')))
  if (dir) targetDir.value = dir
  resetResult()
}

async function selectTargetDir() {
  const path = await window.electronAPI.dialog.openDirectory('选择输出目录')
  if (!path) return
  targetDir.value = path
}

function resetResult() {
  resultMsg.value = ''
  resultType.value = ''
  outputFiles.value = []
  outputDir.value = ''
  progressPercent.value = 0
  progressMsg.value = ''
}

function onProgress(p: { stage: string; percent: number; message: string }) {
  progressPercent.value = p.percent
  progressMsg.value = p.message
}

async function startSeparate() {
  if (!canStart.value) return
  running.value = true
  resetResult()
  progressMsg.value = '启动分离任务…'

  unsubscribe = window.electronAPI.audio.onProgress(onProgress)

  try {
    const result = await window.electronAPI.audio.separate({
      inputPath: sourceFile.value,
      outputDir: targetDir.value,
      mode: mode.value,
      toMp3: toMp3.value
    })
    if (result.success) {
      progressPercent.value = 100
      progressMsg.value = '分离完成'
      outputFiles.value = result.files
      outputDir.value = result.outputDir
      resultMsg.value = `✅ 分离成功，共 ${result.files.length} 个文件`
      resultType.value = 'success'
    } else {
      resultMsg.value = `❌ 分离失败：${result.error || '未知错误'}`
      resultType.value = 'error'
    }
  } catch (e: unknown) {
    resultMsg.value = `❌ 调用失败：${e instanceof Error ? e.message : String(e)}`
    resultType.value = 'error'
  } finally {
    running.value = false
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

async function cancelSeparate() {
  await window.electronAPI.audio.cancel()
  progressMsg.value = '正在取消…'
}

async function openOutputDir() {
  if (!outputDir.value) return
  await window.electronAPI.shell.openPath(outputDir.value)
}

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="tool-title">🎵 人声分离</h2>
      <p class="tool-desc">基于本地 AI 模型（Demucs），把歌曲分离成人声与伴奏。需 Python 3 + demucs，首次运行会下载模型。</p>

      <div class="modes">
        <button
          v-for="m in modeOptions"
          :key="m.id"
          type="button"
          class="mode-btn"
          :class="{ active: mode === m.id }"
          :disabled="running"
          @click="mode = m.id"
        >
          <strong>{{ m.label }}</strong>
          <span>{{ m.desc }}</span>
        </button>
      </div>

      <div class="form-group">
        <label>音频文件</label>
        <div class="file-picker">
          <input type="text" :value="sourceFile" readonly placeholder="请选择音频文件" />
          <button type="button" class="btn btn-primary" :disabled="running" @click="selectSourceFile">选择文件</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出目录</label>
        <div class="file-picker">
          <input type="text" :value="targetDir" readonly placeholder="请选择输出目录" />
          <button type="button" class="btn" :disabled="running" @click="selectTargetDir">选择目录</button>
        </div>
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input v-model="toMp3" type="checkbox" :disabled="running" />
          同时转换为 MP3（需本机安装 FFmpeg）
        </label>
      </div>

      <div class="actions">
        <button
          v-if="!running"
          type="button"
          class="btn btn-primary"
          :disabled="!canStart"
          @click="startSeparate"
        >
          开始分离
        </button>
        <button v-else type="button" class="btn btn-danger" @click="cancelSeparate">取消</button>
      </div>

      <div v-if="running" class="progress-area">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>
        <div class="progress-text">{{ progressMsg }}（{{ progressPercent }}%）</div>
      </div>

      <div v-if="outputFiles.length" class="result-files">
        <div class="result-files-title">输出文件</div>
        <div v-for="f in outputFiles" :key="f.path" class="result-file">
          <span class="file-label">{{ f.label }}</span>
          <span class="file-name">{{ f.name }}</span>
        </div>
        <button type="button" class="btn" @click="openOutputDir">打开输出目录</button>
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
.modes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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
.mode-btn.active { border-color: #ff7eb6; background: #fff5f8; }
.mode-btn:disabled { cursor: not-allowed; opacity: 0.6; }
.form-group { margin-bottom: 12px; }
.form-group > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.file-picker { display: flex; gap: 8px; }
.file-picker input {
  flex: 1;
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  box-sizing: border-box;
  background: #f5f7fa;
  color: #606266;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
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
.btn-danger { background: #f56c6c; border-color: #f56c6c; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.actions { margin-bottom: 12px; }
.progress-area { margin-bottom: 12px; }
.progress-bar {
  height: 8px;
  background: #ebeef5;
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #ff7eb6;
  border-radius: 4px;
  transition: width 0.3s;
}
.progress-text {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
.result-files { margin-bottom: 12px; }
.result-files-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.result-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: 6px;
  margin-bottom: 6px;
  font-size: 13px;
}
.file-label {
  color: #67c23a;
  font-weight: 500;
  white-space: nowrap;
}
.file-name {
  color: #606266;
  font-family: Consolas, monospace;
  word-break: break-all;
}
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
