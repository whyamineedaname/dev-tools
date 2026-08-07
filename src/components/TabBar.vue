<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useTabsStore } from '@/stores/tabs'

const tabsStore = useTabsStore()

// ==================== 右键菜单状态 ====================
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTabId = ref('')

const tabCount = computed(() => tabsStore.tabs.length)

function handleTabClick(tabId: string) {
  tabsStore.setActiveTab(tabId)
}

function handleClose(e: MouseEvent, tabId: string) {
  e.stopPropagation()
  tabsStore.closeTab(tabId)
}

function handleContextMenu(e: MouseEvent, tabId: string) {
  e.preventDefault()
  e.stopPropagation()
  menuTabId.value = tabId
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
}

function closeCurrent() {
  tabsStore.closeTab(menuTabId.value)
  hideMenu()
}

function closeOthers() {
  tabsStore.closeOtherTabs(menuTabId.value)
  hideMenu()
}

function closeAll() {
  tabsStore.closeAllTabs()
  hideMenu()
}

function hideMenu() {
  menuVisible.value = false
}

// 点击任意位置 / 滚动时关闭菜单
function onGlobalClick() {
  hideMenu()
}

function onGlobalScroll() {
  hideMenu()
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
  document.addEventListener('wheel', onGlobalScroll, { passive: true })
  document.addEventListener('scroll', onGlobalScroll, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick)
  document.removeEventListener('wheel', onGlobalScroll)
  document.removeEventListener('scroll', onGlobalScroll, true)
})
</script>

<template>
  <div class="tab-bar">
    <div class="tabs">
      <div
        v-for="tab in tabsStore.tabs"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.id === tabsStore.activeTabId }"
        @click="handleTabClick(tab.id)"
        @contextmenu="handleContextMenu($event, tab.id)"
      >
        <span class="tab-title">{{ tab.title }}</span>
        <button
          class="tab-close"
          @click="handleClose($event, tab.id)"
          @mousedown.stop
        >
          ×
        </button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div
        v-if="menuVisible"
        class="tab-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        @click.stop
        @contextmenu.prevent
      >
        <button class="menu-item" @click="closeCurrent">关闭当前</button>
        <button
          class="menu-item"
          :disabled="tabCount <= 1"
          @click="closeOthers"
        >
          关闭其他
        </button>
        <button class="menu-item danger" @click="closeAll">关闭全部</button>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.tab-bar {
  height: 40px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(4px);
  border-bottom: 1px solid #ffe0ec;
  display: flex;
  align-items: flex-end;
  overflow-x: auto;
  flex-shrink: 0;
}

.tabs {
  display: flex;
  height: 100%;
  padding: 0 8px;
}

.tab {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 12px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  white-space: nowrap;
  user-select: none;
}

.tab:hover {
  color: #333;
  background: #fff0f5;
}

.tab.active {
  color: #ff7eb6;
  border-bottom-color: #ff7eb6;
  background: #ffe8f1;
}

.tab-title {
  margin-right: 8px;
}

.tab-close {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  transition: all 0.2s;
}

.tab-close:hover {
  background: #ddd;
  color: #666;
}
</style>

<!-- 右键菜单样式（teleport 到 body，需非 scoped） -->
<style>
.tab-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 120px;
  padding: 4px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(42, 22, 32, 0.22);
  overflow: hidden;
  animation: tab-menu-in 0.12s ease;
}

@keyframes tab-menu-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.tab-context-menu .menu-item {
  display: block;
  width: 100%;
  padding: 8px 14px;
  font-size: 13px;
  text-align: left;
  color: #4a2a3a;
  border-radius: 5px;
  transition: all 0.15s;
  cursor: pointer;
}

.tab-context-menu .menu-item:hover:not(:disabled) {
  background: #ffe8f1;
  color: #ff7eb6;
}

.tab-context-menu .menu-item:disabled {
  color: #ccc;
  cursor: not-allowed;
}

.tab-context-menu .menu-item.danger:hover:not(:disabled) {
  background: #fff0f0;
  color: #f56c6c;
}
</style>
