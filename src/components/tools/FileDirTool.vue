<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface PathsState {
  tempDir: string | null
  resolvedTempDir: string
  systemTempDir: string
  userDataDir: string
  isCustom: boolean
  fallback: boolean
  fallbackReason: string
}

const paths = ref<PathsState | null>(null)
const loading = ref(false)
const toast = ref('')

function showToast(msg: string) {
  toast.value = msg
  window.setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2200)
}

function applyState(next: PathsState) {
  paths.value = next
}

async function refresh() {
  const res = await window.electronAPI.appPaths.get()
  applyState(res)
}

onMounted(() => {
  void refresh()
})

async function pickTempDir() {
  if (loading.value) return
  const dir = await window.electronAPI.dialog.openDirectory('选择临时文件目录')
  if (!dir) return
  loading.value = true
  try {
    const res = await window.electronAPI.appPaths.setTempDir(dir)
    if (!res.success) {
      showToast(res.error || '设置失败')
      applyState(res)
      return
    }
    applyState(res)
    showToast('临时目录已更新')
  } finally {
    loading.value = false
  }
}

async function resetTempDir() {
  if (loading.value) return
  loading.value = true
  try {
    const res = await window.electronAPI.appPaths.resetTempDir()
    applyState(res)
    showToast('已恢复系统默认临时目录')
  } finally {
    loading.value = false
  }
}

async function openDir(target: string) {
  if (!target) return
  const res = await window.electronAPI.shell.openPath(target)
  if (!res.success) showToast(res.error || '无法打开目录')
}
</script>

<template>
  <div class="tool-page">
    <div class="layout">
      <div class="panel">
        <div class="panel-head">
          <h2 class="title">文件目录</h2>
          <span class="hint">打包成 exe 后，临时文件默认写到系统用户目录（通常在 C 盘）。可改到其他磁盘，避免占满系统盘。</span>
        </div>

        <div v-if="!paths" class="card">
          <p class="card-desc">正在读取目录设置…</p>
        </div>

        <div v-if="paths" class="card">
          <div class="card-head">
            <h3 class="card-title">临时文件目录</h3>
            <span class="badge" :class="paths.isCustom && !paths.fallback ? 'badge-custom' : 'badge-default'">
              {{ paths.isCustom && !paths.fallback ? '自定义' : '系统默认' }}
            </span>
          </div>
          <p class="card-desc">OCR 截图、视频下载中间文件、语音合成临时 wav 等会写到这里；选择输出目录 / 保存文件时也会默认打开此位置。</p>

          <div class="path-box">
            <span class="path-label">当前使用</span>
            <code class="path-value">{{ paths.resolvedTempDir }}</code>
          </div>

          <div v-if="paths.isCustom && paths.tempDir !== paths.resolvedTempDir" class="path-box muted">
            <span class="path-label">已设置</span>
            <code class="path-value">{{ paths.tempDir }}</code>
          </div>

          <div class="path-box muted">
            <span class="path-label">系统默认</span>
            <code class="path-value">{{ paths.systemTempDir }}</code>
          </div>

          <p v-if="paths.fallback" class="warn">
            自定义目录无法写入，已回退系统临时目录。{{ paths.fallbackReason }}
          </p>

          <div class="actions">
            <button class="btn btn-primary" :disabled="loading" @click="pickTempDir">选择目录</button>
            <button class="btn" :disabled="loading || !paths.resolvedTempDir" @click="openDir(paths.resolvedTempDir)">
              打开文件夹
            </button>
            <button class="btn" :disabled="loading || !paths.isCustom" @click="resetTempDir">恢复默认</button>
          </div>
        </div>

        <div v-if="paths" class="card">
          <div class="card-head">
            <h3 class="card-title">应用数据目录</h3>
            <span class="badge badge-default">只读</span>
          </div>
          <p class="card-desc">主题图、剪贴板历史、阅读进度等配置仍保存在用户数据目录，体积较小，由系统管理。</p>
          <div class="path-box">
            <span class="path-label">位置</span>
            <code class="path-value">{{ paths.userDataDir }}</code>
          </div>
          <div class="actions">
            <button class="btn" @click="openDir(paths.userDataDir)">打开文件夹</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.tool-page {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 20px;
}

.layout {
  width: 100%;
  max-width: 920px;
}

.panel {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0;
  flex-shrink: 0;
}

.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  text-align: right;
}

.card {
  border: 1px solid #f0f0f0;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.card-desc {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.badge-custom {
  color: #c4567a;
  background: #ffe8f1;
}

.badge-default {
  color: #909399;
  background: #f4f4f5;
}

.path-box {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  background: #fafafa;
  border-radius: 8px;
}

.path-box.muted {
  background: #fcfcfc;
}

.path-label {
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
  width: 56px;
  padding-top: 1px;
}

.path-value {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: #4a2a3a;
  word-break: break-all;
  font-family: Consolas, 'Courier New', monospace;
}

.warn {
  margin: 0;
  font-size: 12px;
  color: #c4567a;
  background: #fff5f8;
  border-radius: 8px;
  padding: 8px 10px;
  line-height: 1.5;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  background: #ffe8f1;
  color: #c4567a;
  transition: background 0.2s;
}

.btn:hover:not(:disabled) {
  background: #ffd6e7;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-primary {
  background: #ff7eb6;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #ff6aa8;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  z-index: 999;
  padding: 10px 20px;
  border-radius: 8px;
  background: rgba(42, 22, 32, 0.85);
  color: #fff;
  font-size: 13px;
  animation: toast-in 0.2s ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
