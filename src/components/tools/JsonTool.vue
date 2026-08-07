<script setup lang="ts">
import { ref, computed } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'

const inputValue = ref('{\n  "name": "兔丝",\n  "version": "1.0.0",\n  "features": ["JSON格式化", "转义", "去转义"]\n}')
const errorMsg = ref('')
const copySuccess = ref(false)
const dragActive = ref(false)

const extensions = [json()]

// Electron 拖拽文件时 File 对象附带 path 属性
interface FileWithPath extends File {
  path: string
}

async function loadFileContent(filePath: string) {
  const result = await window.electronAPI.file.readText(filePath)
  if (result.success && result.content !== undefined) {
    inputValue.value = result.content
    errorMsg.value = ''
  } else {
    errorMsg.value = `读取失败：${result.error || '未知错误'}`
  }
}

async function openJsonFile() {
  const filePath = await window.electronAPI.dialog.openFile({
    title: '选择 JSON 文件',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }]
  })
  if (filePath) {
    await loadFileContent(filePath)
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  if (!dragActive.value) dragActive.value = true
}

function onDragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement
  const related = e.relatedTarget as Node | null
  if (!related || !target.contains(related)) {
    dragActive.value = false
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragActive.value = false
  const file = e.dataTransfer?.files?.[0] as FileWithPath | undefined
  if (!file) return
  if (file.name && !file.name.toLowerCase().endsWith('.json')) {
    errorMsg.value = '请拖入 .json 文件'
    return
  }
  await loadFileContent(file.path)
}

function formatJson() {
  try {
    const obj = JSON.parse(inputValue.value)
    inputValue.value = JSON.stringify(obj, null, 2)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = `JSON 格式错误：${e.message}`
  }
}

function compressJson() {
  try {
    const obj = JSON.parse(inputValue.value)
    inputValue.value = JSON.stringify(obj)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = `JSON 格式错误：${e.message}`
  }
}

function escapeJson() {
  try {
    // 先验证 JSON 有效性
    JSON.parse(inputValue.value)
    // 转义：将 JSON 字符串转为转义后的字符串
    inputValue.value = JSON.stringify(inputValue.value)
    // 去掉首尾的引号
    inputValue.value = inputValue.value.slice(1, -1)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = `转义失败：${e.message}`
  }
}

function unescapeJson() {
  try {
    // 去转义：将转义后的字符串还原
    inputValue.value = JSON.parse(`"${inputValue.value}"`)
    errorMsg.value = ''
  } catch (e: any) {
    errorMsg.value = `去转义失败：${e.message}`
  }
}

function copyToClipboard() {
  navigator.clipboard.writeText(inputValue.value).then(() => {
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  })
}

function clearContent() {
  inputValue.value = ''
  errorMsg.value = ''
}

const charCount = computed(() => inputValue.value.length)
const lineCount = computed(() => inputValue.value.split('\n').length)
</script>

<template>
  <div class="json-tool">
    <div class="toolbar">
      <div class="toolbar-left">
        <button class="btn btn-primary" @click="openJsonFile">📂 打开文件</button>
        <span class="divider"></span>
        <button class="btn" @click="formatJson">格式化</button>
        <button class="btn" @click="compressJson">压缩</button>
        <span class="divider"></span>
        <button class="btn" @click="escapeJson">转义</button>
        <button class="btn" @click="unescapeJson">去转义</button>
      </div>
      <div class="toolbar-right">
        <button class="btn" @click="copyToClipboard">
          {{ copySuccess ? '✓ 已复制' : '复制' }}
        </button>
        <button class="btn btn-danger" @click="clearContent">清空</button>
      </div>
    </div>

    <div v-if="errorMsg" class="error-bar">
      ⚠️ {{ errorMsg }}
    </div>

    <div
      class="editor-container"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <Codemirror
        v-model="inputValue"
        :style="{ height: '100%' }"
        :autofocus="true"
        :indent-with-tab="true"
        :tab-size="2"
        :extensions="extensions"
        :theme="oneDark"
      />
      <div v-if="dragActive" class="drag-overlay">
        <div class="drag-hint">松开以加载 JSON 文件</div>
      </div>
    </div>

    <div class="status-bar">
      <span>行数：{{ lineCount }}</span>
      <span>字符数：{{ charCount }}</span>
    </div>
  </div>
</template>

<style scoped>
.json-tool {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.divider {
  width: 1px;
  height: 20px;
  background: #ddd;
  margin: 0 4px;
}

.btn {
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid #dcdfe6;
  color: #606266;
  transition: all 0.2s;
}

.btn:hover {
  color: #ff7eb6;
  border-color: #ffc2d9;
  background: #ffe8f1;
}

.btn-primary {
  background: #ff7eb6;
  border-color: #ff7eb6;
  color: #fff;
}

.btn-primary:hover {
  background: #ff5c9d;
  border-color: #ff5c9d;
  color: #fff;
}

.btn-danger {
  color: #f56c6c;
  border-color: #fbc4c4;
}

.btn-danger:hover {
  background: #fef0f0;
  border-color: #f56c6c;
  color: #f56c6c;
}

.error-bar {
  padding: 10px 16px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 13px;
  border-bottom: 1px solid #fbc4c4;
}

.editor-container {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(42, 22, 32, 0.6);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.drag-hint {
  padding: 18px 36px;
  border: 2px dashed #ff7eb6;
  border-radius: 12px;
  background: rgba(255, 232, 241, 0.92);
  color: #ff5c9d;
  font-size: 15px;
  font-weight: 600;
}

.editor-container :deep(.cm-editor) {
  height: 100%;
  font-size: 14px;
}

.editor-container :deep(.cm-scroller) {
  font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
}

.status-bar {
  display: flex;
  gap: 20px;
  padding: 8px 16px;
  font-size: 12px;
  color: #909399;
  border-top: 1px solid #eee;
  background: #fafafa;
}
</style>
