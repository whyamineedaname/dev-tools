<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useThemeStore } from '@/stores/theme'
import type { ThemeConfig } from '@/types/theme'

const themeStore = useThemeStore()

/** 当前编辑的主题 id（默认跟随激活主题） */
const editingId = ref(themeStore.activeThemeId)
const nameInput = ref('')
const toast = ref('')

const editing = computed<ThemeConfig | null>(() =>
  themeStore.themes.find(t => t.id === editingId.value) ?? null
)

onMounted(() => {
  // 打开工具时同步当前激活主题的名称到输入框，避免误保存空名
  nameInput.value = themeStore.getActiveTheme().name
})

/** 6 个背景图段的配置（中文标签 → store 字段） */
const bgFields: { key: keyof ThemeConfig; label: string }[] = [
  { key: 'mainBg', label: '主画面背景' },
  { key: 'rightBottomBg', label: '右下角图' },
  { key: 'navTopBg', label: '导航顶部图' },
  { key: 'navDrawerBg', label: '导航收折图' },
  { key: 'navMenuBg', label: '导航菜单背景' },
  { key: 'navBottomBg', label: '导航底部图' }
]

/** 主题色段：纯色字段用 color 控件，rgba 字段仅文本 */
const colorFields: { key: keyof ThemeConfig; label: string }[] = [
  { key: 'primaryColor', label: '主色' },
  { key: 'primaryHover', label: '主色增强' },
  { key: 'sidebarBg', label: '侧边栏底色' },
  { key: 'navBlockBg', label: '导航块底色' },
  { key: 'accentText', label: '强调文字' },
  { key: 'dimText', label: '次要文字' },
  { key: 'contentBg', label: '内容区背景' }
]

const ALPHA_FIELDS = new Set<string>(['contentBg'])

function showToast(msg: string) {
  toast.value = msg
  window.setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2000)
}

function selectTheme(id: string) {
  if (editingId.value === id) return
  editingId.value = id
  nameInput.value = themeStore.themes.find(t => t.id === id)?.name ?? ''
}

function createTheme() {
  const name = nameInput.value.trim() || `主题${themeStore.themes.length}`
  const theme = themeStore.addTheme(name)
  editingId.value = theme.id
  themeStore.switchTheme(theme.id)
  nameInput.value = name
  showToast(`已创建并切换到「${name}」`)
}

/** 保存当前编辑主题的名称 */
function renameName() {
  if (!editing.value) return
  const name = nameInput.value.trim() || '未命名主题'
  themeStore.renameTheme(editing.value.id, name)
  nameInput.value = name
  showToast('名称已保存')
}

/** 删除当前编辑的主题 */
function removeTheme() {
  const t = editing.value
  if (!t) return
  if (t.id === 'theme-default') {
    showToast('默认主题不可删除')
    return
  }
  themeStore.removeTheme(t.id)
  editingId.value = themeStore.activeThemeId
  nameInput.value = themeStore.getActiveTheme().name
  showToast(`已删除「${t.name}」`)
}

/** 选择背景图文件 → IPC 原样保存到 userData/theme-images → 更新主题为 tusi-img:// 路径 */
function onPickBg(field: keyof ThemeConfig, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    const base64 = typeof reader.result === 'string'
      ? reader.result.slice(reader.result.indexOf(',') + 1)
      : ''
    try {
      const res = await window.electronAPI.theme.saveImage(file.name, base64)
      if (res.success && editing.value) {
        themeStore.updateTheme(editing.value.id, {
          [field]: `url("${res.url}")`
        } as Partial<ThemeConfig>)
        showToast('背景图已更新')
      } else {
        showToast('保存图片失败')
      }
    } catch {
      showToast('保存图片失败')
    }
  }
  reader.onerror = () => showToast('读取图片失败')
  reader.readAsDataURL(file)
  ;(e.target as HTMLInputElement).value = ''
}

/** 主题色变更 */
function setColor(field: keyof ThemeConfig, value: string) {
  if (!editing.value) return
  themeStore.updateTheme(editing.value.id, { [field]: value } as Partial<ThemeConfig>)
}

/** 当前编辑主题的背景图/图标图全部恢复默认 */
function resetBgToDefault() {
  if (!editing.value) return
  themeStore.resetImagesToDefault(editing.value.id)
  showToast('背景图已恢复默认')
}

/** 纯色字段是否可用 color 控件（排除 rgba） */
function isColor(field: keyof ThemeConfig): boolean {
  return !ALPHA_FIELDS.has(field as string)
}

/** 转为 <input type="color"> 可用的 hex（#rrggbb），无法解析时返回 #000000 */
function toColorValue(field: keyof ThemeConfig): string {
  if (!editing.value) return '#000000'
  const raw = editing.value[field]
  // #abc / #aabbcc
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) {
    let hex = raw.replace('#', '')
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    return `#${hex.toLowerCase()}`
  }
  // rgb(r, g, b)
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(raw)
  if (m) {
    const toHex = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`
  }
  return '#000000'
}
</script>

<template>
  <div class="tool-page">
    <div class="theme-layout">
      <!-- 左侧：主题列表 -->
      <div class="theme-list">
        <div class="list-header">
          <h2 class="title">主题方案</h2>
          <button class="btn btn-primary btn-sm" @click="createTheme">新建</button>
        </div>
        <div class="list-body">
          <button
            v-for="t in themeStore.themes"
            :key="t.id"
            class="theme-item"
            :class="{ active: t.id === editingId }"
            @click="selectTheme(t.id)"
          >
            <span class="dot" :style="{ background: t.primaryColor }"></span>
            <span class="item-name">{{ t.name }}</span>
            <span v-if="t.id === themeStore.activeThemeId" class="using-tag">使用中</span>
          </button>
          <p v-if="themeStore.themes.length === 0" class="empty-hint">暂无主题</p>
        </div>
        <button class="btn btn-danger btn-sm" :disabled="editing?.id === 'theme-default'" @click="removeTheme">
          删除当前主题
        </button>
      </div>

      <!-- 右侧：编辑区 -->
      <div v-if="editing" class="theme-editor">
        <div class="editor-head">
          <h2 class="title">主题编辑</h2>
          <button
            class="btn btn-primary"
            :disabled="editing.id === themeStore.activeThemeId"
            @click="themeStore.switchTheme(editing.id)"
          >
            {{ editing.id === themeStore.activeThemeId ? '当前使用中' : '一键切换' }}
          </button>
        </div>

        <!-- 命名 -->
        <div class="field-row">
          <label class="field-label">主题名称</label>
          <input
            v-model="nameInput"
            class="text-input"
            placeholder="输入主题名称"
            @blur="renameName"
            @keyup.enter="renameName"
          />
          <button class="btn btn-sm" @click="renameName">保存名称</button>
        </div>

        <!-- 背景图 -->
        <div class="section">
          <div class="section-head">
            <h3 class="section-title">背景图</h3>
            <button
              class="btn btn-sm"
              title="把 6 处背景图与图标图全部恢复为默认图（主题色保持不变）"
              @click="resetBgToDefault"
            >
              恢复默认背景图
            </button>
          </div>
          <div class="bg-grid">
            <div v-for="f in bgFields" :key="f.key" class="bg-item">
              <div
                class="bg-preview"
                :style="{ backgroundImage: editing[f.key] || 'none', backgroundSize: 'cover', backgroundPosition: 'center' }"
                :title="editing[f.key]"
              >
                <span v-if="!editing[f.key]" class="no-bg">无</span>
              </div>
              <span class="bg-label">{{ f.label }}</span>
              <label class="choose-btn">
                选择图片
                <input type="file" accept="image/*" @change="onPickBg(f.key, $event)" />
              </label>
            </div>
          </div>
        </div>

        <!-- 主题色 -->
        <div class="section">
          <h3 class="section-title">主题色</h3>
          <div class="color-list">
            <div v-for="c in colorFields" :key="c.key" class="color-item">
              <span class="color-label">{{ c.label }}</span>
              <div class="color-controls">
                <input
                  v-if="isColor(c.key)"
                  type="color"
                  :value="toColorValue(c.key)"
                  @input="setColor(c.key, ($event.target as HTMLInputElement).value)"
                />
                <input
                  type="text"
                  class="color-text"
                  :value="editing[c.key]"
                  @change="setColor(c.key, ($event.target as HTMLInputElement).value)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="theme-editor empty">
        <p>选择一个主题进行编辑</p>
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

.theme-layout {
  width: 100%;
  max-width: 920px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

/* ==================== 左侧主题列表 ==================== */

.theme-list {
  width: 240px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.list-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 420px;
  overflow-y: auto;
}

.theme-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: #4a2a3a;
  text-align: left;
  transition: background 0.2s;
}

.theme-item:hover {
  background: #ffe8f1;
}

.theme-item.active {
  background: #ffe8f1;
  box-shadow: inset 0 0 0 2px #ff7eb6;
}

.dot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.using-tag {
  font-size: 11px;
  color: #ff7eb6;
  flex-shrink: 0;
}

.empty-hint {
  color: #bbb;
  font-size: 13px;
  padding: 20px 0;
  text-align: center;
}

/* ==================== 右侧编辑区 ==================== */

.theme-editor {
  flex: 1;
  min-width: 0;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.theme-editor.empty {
  align-items: center;
  justify-content: center;
  color: #bbb;
  font-size: 14px;
}

.editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field-label {
  font-size: 13px;
  color: #606266;
  flex-shrink: 0;
}

.text-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  transition: border-color 0.2s;
}

.text-input:focus {
  border-color: #ff7eb6;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0f0f0;
}

.section-head .section-title {
  padding-bottom: 0;
  border-bottom: none;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  padding-bottom: 6px;
  border-bottom: 1px solid #f0f0f0;
}

/* 背景图网格 */
.bg-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.bg-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.bg-preview {
  width: 100%;
  height: 64px;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  background-color: #f5f7fa;
  overflow: hidden;
}

.no-bg {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #c0c4cc;
  font-size: 12px;
}

.bg-label {
  font-size: 12px;
  color: #909399;
}

/* 选择图片（隐藏原生 input） */
.choose-btn {
  font-size: 12px;
  color: #ff7eb6;
  background: #ffe8f1;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.choose-btn:hover {
  background: #ffd6e7;
}

.choose-btn input {
  display: none;
}

/* 主题色列表 */
.color-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.color-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.color-label {
  width: 90px;
  flex-shrink: 0;
  font-size: 13px;
  color: #606266;
}

.color-controls {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-controls input[type='color'] {
  width: 40px;
  height: 28px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 2px;
  background: #fff;
  cursor: pointer;
}

.color-text {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  font-family: Consolas, 'Courier New', monospace;
  color: #303133;
}

.color-text:focus {
  border-color: #ff7eb6;
}

/* ==================== 按钮 & toast ==================== */

.btn {
  padding: 8px 16px;
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
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}

.btn-primary {
  background: #ff7eb6;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #ff5c9d;
}

.btn-danger {
  background: #fef0f0;
  color: #f56c6c;
}

.btn-danger:hover:not(:disabled) {
  background: #fde2e2;
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