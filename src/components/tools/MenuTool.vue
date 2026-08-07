<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { tools, categories, logoIcon } from '@/config/tools'
import { useMenuStore } from '@/stores/menu'

const menuStore = useMenuStore()
const toast = ref('')

function showToast(msg: string) {
  toast.value = msg
  window.setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2000)
}

/** 上传图片 → 原样保存到用户目录 → 返回 tusi-img:// 路径 */
async function saveImageFile(file: File): Promise<string> {
  const reader = new FileReader()
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(typeof reader.result === 'string'
      ? reader.result.slice(reader.result.indexOf(',') + 1)
      : '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const res = await window.electronAPI.theme.saveImage(`icon.png`, base64)
  if (!res.success) throw new Error(res.error || '保存图片失败')
  return res.url
}

/** 更换分类图标 */
async function onChangeCategoryIcon(id: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const url = await saveImageFile(file)
    menuStore.setCategoryIcon(id, url)
    showToast('分类图标已更新')
  } catch {
    showToast('保存图片失败')
  }
  ;(e.target as HTMLInputElement).value = ''
}

/** 更换工具图标 */
async function onChangeToolIcon(id: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const url = await saveImageFile(file)
    menuStore.setToolIcon(id, url)
    showToast('工具图标已更新')
  } catch {
    showToast('保存图片失败')
  }
  ;(e.target as HTMLInputElement).value = ''
}

onMounted(() => {
  // 确保持久化图标已加载
  menuStore.init()
})
</script>

<template>
  <div class="tool-page">
    <div class="menu-layout">
      <!-- ==================== Logo 区（当前固定，不提供修改） ==================== -->
      <div class="panel logo-panel">
        <div class="panel-head">
          <h2 class="title">菜单图标</h2>
          <span class="hint">点击「更换图标」即可替换侧边栏菜单图标，图片会保存到本地</span>
        </div>
        <div class="logo-row">
          <div class="icon-cell current-icon">
            <img :src="logoIcon" alt="" class="thumb" />
          </div>
          <div class="cell-info">
            <span class="cell-name">应用 Logo</span>
            <span class="cell-sub">固定图标的预览</span>
          </div>
        </div>
      </div>

      <!-- ==================== 分类图标 ==================== -->
      <div class="menu-group">
        <h3 class="group-title">分类图标</h3>
        <div class="menu-grid">
          <div v-for="c in categories" :key="c.id" class="menu-item">
            <div class="current-icon">
              <img :src="menuStore.getCategoryIcon(c.id, c.icon)" alt="" class="thumb" />
            </div>
            <div class="cell-info">
              <span class="cell-name">{{ c.name }}</span>
              <span class="cell-sub">{{ c.id }}</span>
            </div>
            <label class="action-btn">
              更换
              <input type="file" accept="image/*" @change="onChangeCategoryIcon(c.id, $event)" />
            </label>
            <button
              class="action-btn reset-btn"
              :disabled="!menuStore.isCategoryCustom(c.id)"
              @click="menuStore.resetCategoryIcon(c.id)"
            >
              恢复
            </button>
          </div>
        </div>
      </div>

      <!-- ==================== 工具图标 ==================== -->
      <div class="menu-group">
        <h3 class="group-title">工具图标</h3>
        <div class="menu-grid">
          <div v-for="t in tools" :key="t.id" class="menu-item">
            <div class="current-icon">
              <img :src="menuStore.getToolIcon(t.id, t.icon)" alt="" class="thumb" />
            </div>
            <div class="cell-info">
              <span class="cell-name">{{ t.name }}</span>
              <span class="cell-sub">{{ t.id }}</span>
            </div>
            <label class="choose-btn">
              更换
              <input type="file" accept="image/*" @change="onChangeToolIcon(t.id, $event)" />
            </label>
            <button
              class="choose-btn reset-btn"
              :disabled="!menuStore.isToolCustom(t.id)"
              @click="menuStore.resetToolIcon(t.id)"
            >
              恢复
            </button>
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

.menu-layout {
  width: 100%;
  max-width: 920px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.hint {
  font-size: 12px;
  color: #909399;
}

.logo-panel {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu-group {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.group-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 12px;
}

.menu-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  transition: background 0.2s;
}

.menu-item:hover {
  background: #fff5f8;
}

.current-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #ffe0ec, #fff5f8);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.thumb {
  width: 26px;
  height: 26px;
  object-fit: cover;
}

.cell-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-name {
  font-size: 13px;
  color: #4a2a3a;
  font-weight: 500;
}

.cell-sub {
  font-size: 11px;
  color: #b5a0aa;
}

.choose-btn {
  font-size: 12px;
  color: #ff7eb6;
  background: #ffe8f1;
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s;
}

.choose-btn:hover:not(:disabled) {
  background: #ffd6e7;
}

.choose-btn input {
  display: none;
}

.reset-btn {
  color: #909399;
  background: #f4f4f5;
}

.reset-btn:hover:not(:disabled) {
  background: #e4e7ed;
}

.reset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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