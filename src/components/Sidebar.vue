<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { categories, logoIcon, tools } from '@/config/tools'
import { useTabsStore } from '@/stores/tabs'
import { useMenuStore } from '@/stores/menu'

const tabsStore = useTabsStore()
const menuStore = useMenuStore()

/** 导航栏是否收起 */
const collapsed = ref(false)

/** 当前弹出的分类 id，null 表示无弹窗 */
const activeCategoryId = ref<string | null>(null)
/** 弹窗相对侧边栏顶部的偏移（跟随被点击的菜单项） */
const popoverTop = ref(0)
const sidebarRef = ref<HTMLElement | null>(null)

// 面板内显示用的短名（≤4 个中文字符宽：2 英文 = 1 中文），全称通过 title hover 显示
const shortNames: Record<string, string> = {
  json: 'JSON',
  crypto: '加解密',
  regex: '正则',
  timestamp: '时间戳',
  diff: '对比',
  formatConvert: '格式转',
  cron: 'Cron',
  clipboardHistory: '剪贴板',
  fileToMd: '转MD',
  docToPdf: '转PDF',
  docReader: '阅读器',
  mp4ToWebp: '转WebP',
  mediaTranscode: '转码',
  voiceSeparate: '人声',
  ocr: 'OCR',
  colorPicker: '取色器',
  removeBg: '去背景',
  qrcode: '二维码',
  imageResize: '压缩图',
  exifTool: 'EXIF',
  puzzle: '拼图',
  httpClient: 'HTTP',
  portTool: '端口',
  dnsTool: 'DNS',
  dataSync: '同步',
  biliDownloader: '下载',
  loanCalc: '房贷',
  theme: '主题',
  menu: '菜单'
}

const activeCategory = computed(() =>
  categories.find(c => c.id === activeCategoryId.value) ?? null
)

function getToolsByCategory(categoryId: string) {
  return tools.filter(t => t.category === categoryId)
}

function getShortName(toolId: string) {
  return shortNames[toolId] ?? tools.find(t => t.id === toolId)?.name ?? toolId
}

function openCategory(categoryId: string, event: MouseEvent) {
  // 再次点击当前分类则收起
  if (activeCategoryId.value === categoryId) {
    activeCategoryId.value = null
    return
  }
  activeCategoryId.value = categoryId
  const btn = event.currentTarget as HTMLElement
  const sidebarRect = sidebarRef.value!.getBoundingClientRect()
  popoverTop.value = btn.getBoundingClientRect().top - sidebarRect.top
}

function handleToolClick(toolId: string) {
  tabsStore.openTool(toolId)
  activeCategoryId.value = null
}

/** 切换导航栏收起/展开，收起时同时关闭分类弹窗 */
function toggleCollapse() {
  collapsed.value = !collapsed.value
  if (collapsed.value) {
    activeCategoryId.value = null
  }
}

// 点击侧边栏外部任意位置关闭弹窗
function onDocumentClick(event: MouseEvent) {
  if (!activeCategoryId.value) return
  const target = event.target as Node
  if (!sidebarRef.value?.contains(target)) {
    activeCategoryId.value = null
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <aside ref="sidebarRef" class="sidebar" :class="{ collapsed }">
    <!-- 抽屉按钮：收起/展开导航栏，背景图为 side-nav-drawer.png -->
    <button
      class="collapse-btn"
      :class="{ collapsed }"
      :title="collapsed ? '展开导航栏' : '收起导航栏'"
      @click.stop="toggleCollapse"
    ></button>
    <div class="sidebar-header">
      
    </div>
    <nav class="sidebar-nav">
      <button
        v-for="category in categories"
        :key="category.id"
        class="category-header"
        :class="{ active: activeCategoryId === category.id }"
        @click="openCategory(category.id, $event)"
      >
        <img :src="menuStore.getCategoryIcon(category.id, category.icon)" alt="" class="category-icon" />
        <span class="category-name">{{ category.name }}</span>
        <span class="category-more">›</span>
      </button>
    </nav>
    <div class="sidebar-decor" aria-hidden="true"></div>

    <transition name="pop">
      <div
        v-if="activeCategory"
        class="category-popover"
        :style="{ top: popoverTop + 'px' }"
      >
        <div class="popover-header">
          <img :src="menuStore.getCategoryIcon(activeCategory.id, activeCategory.icon)" alt="" class="popover-icon" />
          <span class="popover-title">{{ activeCategory.name }}</span>
        </div>
        <div class="tool-grid">
          <button
            v-for="tool in getToolsByCategory(activeCategory.id)"
            :key="tool.id"
            class="tool-card"
            :class="{ active: tabsStore.activeTab?.toolId === tool.id }"
            :title="tool.name"
            @click="handleToolClick(tool.id)"
          >
            <span class="tool-card-icon">
              <img :src="menuStore.getToolIcon(tool.id, tool.icon)" alt="" />
            </span>
            <span class="tool-card-name">{{ getShortName(tool.id) }}</span>
          </button>
          <div v-if="getToolsByCategory(activeCategory.id).length === 0" class="popover-empty">
            暂无工具
          </div>
        </div>
      </div>
    </transition>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  background-color: var(--tusi-sidebar-bg);
  color: var(--tusi-accent-text);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  transition: width 0.25s ease;
}

.sidebar.collapsed {
  width: 0;
}

/* 折叠时隐藏内部内容（弹窗为 absolute 定位，不受影响） */
.sidebar.collapsed .sidebar-header,
.sidebar.collapsed .sidebar-nav,
.sidebar.collapsed .sidebar-decor {
  display: none;
}

/* ==================== 抽屉收放按钮 ==================== */

.collapse-btn {
  position: absolute;
  top: 118px;
  right: -25px;
  z-index: 20;
  width: 100px;
  height: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0;
  background-color: transparent;
  background-image: var(--tusi-nav-drawer-bg);
  background-size: 100% 100%;
  background-repeat: no-repeat;
  background-position: center;
  cursor: pointer;
  opacity: 0.3;
  transition: all 0.25s ease;
}

.collapse-btn:hover {
  filter: brightness(1.15);
  opacity: 0.7;
}

.collapse-btn.collapsed {
  position: fixed;
  left: -75px;
  top: 118px;
  right: auto;
  transform: rotate(180deg);
}

.sidebar-header {
  flex: none;
  padding: 53px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  background-color: var(--tusi-nav-block-bg);
  background-image: var(--tusi-nav-top-bg);
  background-size: cover;
  background-repeat: no-repeat;
  background-position: left bottom;
  mix-blend-mode: screen;
  opacity: 0.85;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.logo-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0;
  position: relative;
  z-index: 1;
  background-color: var(--tusi-nav-block-bg);
  background-image:
    linear-gradient(rgba(20, 16, 18, 0.52), rgba(20, 16, 18, 0.68)),
    var(--tusi-nav-menu-bg);
  background-size: cover;
  background-position: bottom;
  background-repeat: no-repeat;
}

.category-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 16px;
  color: var(--tusi-dim-text);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.category-header:hover {
  background: rgba(61, 31, 46, 0.78);
  color: var(--tusi-accent-text);
}

.category-header.active {
  background: rgba(61, 31, 46, 0.86);
  color: var(--tusi-primary);
}

.category-icon {
  width: 20px;
  height: 20px;
  margin-right: 10px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.category-name {
  flex: 1;
  text-align: left;
}

.category-more {
  font-size: 16px;
  color: #b3839b;
  transition: transform 0.2s;
}

.category-header.active .category-more {
  transform: rotate(90deg);
  color: var(--tusi-primary);
}

/* ==================== 分类弹窗（手机 App 风格） ==================== */

.category-popover {
  position: absolute;
  left: calc(100% + 8px);
  z-index: 100;
  width: 316px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(42, 22, 32, 0.3);
  padding: 14px;
  box-sizing: border-box;
}

.popover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid #f7e3ec;
}

.popover-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  object-fit: cover;
}

.popover-title {
  font-size: 14px;
  font-weight: 600;
  color: #2a1620;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 8px;
}

.tool-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 2px;
  border-radius: 12px;
  transition: all 0.2s;
}

.tool-card:hover {
  background: #fff0f5;
}

.tool-card:hover .tool-card-icon {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--tusi-primary) 35%, transparent);
}

.tool-card.active {
  background: color-mix(in srgb, var(--tusi-primary) 30%, #fff);
}

.tool-card-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: linear-gradient(135deg, #ffe0ec, #fff5f8);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.tool-card-icon img {
  width: 26px;
  height: 26px;
  object-fit: cover;
}

.tool-card-name {
  font-size: 12px;
  color: #7a4a5e;
  max-width: 88px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-card.active .tool-card-name {
  color: var(--tusi-primary);
  font-weight: 600;
}

.popover-empty {
  grid-column: 1 / -1;
  padding: 24px 0;
  text-align: center;
  color: #bbb;
  font-size: 13px;
}

/* 弹窗过渡动画 */
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

/* ==================== 底部装饰 ==================== */

.sidebar-decor {
  flex: 0 0 200px;
  pointer-events: none;
  user-select: none;
  width: 100%;
  min-height: 200px;
  background-color: var(--tusi-nav-block-bg);
  background-image: var(--tusi-nav-bottom-bg);
  background-size: cover;
  background-repeat: no-repeat;
  background-position: left bottom;
  mix-blend-mode: screen;
  opacity: 0.85;
}
</style>
