<script setup lang="ts">
import { ref, computed } from 'vue'

const sourceFile = ref('')
const targetDir = ref('')
const outputFileName = ref('')
const converting = ref(false)
const resultMsg = ref('')
const resultType = ref<'success' | 'error' | ''>('')

const canConvert = computed(() => {
  return sourceFile.value && targetDir.value && !converting.value
})

const outputPath = computed(() => {
  if (!targetDir.value || !outputFileName.value) return ''
  return `${targetDir.value}\\${outputFileName.value}`
})

async function selectSourceFile() {
  const path = await window.electronAPI.dialog.openFile({
    title: '选择源文件',
    filters: [
      { name: '所有支持的文件', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'html'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (path) {
    sourceFile.value = path
    // 自动填充输出目录：源文件所在目录
    const dir = path.substring(0, path.lastIndexOf('\\'))
    if (dir) targetDir.value = dir
    // 自动生成默认输出文件名
    const name = path.split('\\').pop() || ''
    const nameWithoutExt = name.replace(/\.[^.]+$/, '')
    outputFileName.value = `${nameWithoutExt}.md`
    resultMsg.value = ''
    resultType.value = ''
  }
}

async function selectTargetDir() {
  const path = await window.electronAPI.dialog.openDirectory('选择输出目录')
  if (path) {
    targetDir.value = path
    resultMsg.value = ''
    resultType.value = ''
  }
}

async function startConvert() {
  if (!canConvert.value) return

  converting.value = true
  resultMsg.value = '正在转换中...'
  resultType.value = ''

  try {
    const result = await window.electronAPI.python.fileToMd(sourceFile.value, outputPath.value)
    if (result.success) {
      resultMsg.value = `✅ 转换成功！输出文件：${outputPath.value}`
      resultType.value = 'success'
    } else {
      resultMsg.value = `❌ 转换失败：${result.error || '未知错误'}`
      resultType.value = 'error'
    }
  } catch (e: any) {
    resultMsg.value = `❌ 调用失败：${e.message}`
    resultType.value = 'error'
  } finally {
    converting.value = false
  }
}

function openOutputDir() {
  if (targetDir.value) {
    window.electronAPI.python.fileToMd('', '') // 占位，实际用 shell 打开
    // 简单起见，直接在资源管理器中打开
    const { shell } = require('electron')
    shell.openPath(targetDir.value)
  }
}
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="tool-title">📄 文档转 Markdown</h2>
      <p class="tool-desc">支持 PDF、Word、Excel、PPT、TXT 等多种格式转换为 Markdown</p>

      <div class="form-group">
        <label>源文件</label>
        <div class="file-picker">
          <input type="text" :value="sourceFile" readonly placeholder="请选择源文件" />
          <button class="btn btn-primary" @click="selectSourceFile">选择文件</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出目录</label>
        <div class="file-picker">
          <input type="text" :value="targetDir" readonly placeholder="请选择输出目录" />
          <button class="btn btn-primary" @click="selectTargetDir">选择目录</button>
        </div>
      </div>

      <div class="form-group">
        <label>输出文件名</label>
        <input type="text" v-model="outputFileName" placeholder="例如：output.md" />
      </div>

      <div v-if="outputPath" class="output-path">
        <span class="label">完整输出路径：</span>
        <span class="path">{{ outputPath }}</span>
      </div>

      <div class="action-bar">
        <button
          class="btn btn-primary btn-large"
          :disabled="!canConvert"
          @click="startConvert"
        >
          {{ converting ? '转换中...' : '开始转换' }}
        </button>
      </div>

      <div
        v-if="resultMsg"
        class="result-bar"
        :class="resultType"
      >
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
  max-width: 600px;
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
  margin-bottom: 28px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 8px;
}

.form-group input[type="text"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-group input[type="text"]:focus {
  border-color: #ff7eb6;
}

.file-picker {
  display: flex;
  gap: 10px;
}

.file-picker input {
  flex: 1;
  background: #f5f7fa;
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
  margin-bottom: 20px;
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
</style>
