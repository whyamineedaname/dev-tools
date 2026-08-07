import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Tab } from '@/types'
import { tools } from '@/config/tools'

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([
    { id: 'json-1', toolId: 'json', title: 'JSON 格式化' }
  ])
  const activeTabId = ref('json-1')

  const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))

  function openTool(toolId: string) {
    const tool = tools.find(t => t.id === toolId)
    if (!tool) return

    const existingTab = tabs.value.find(t => t.toolId === toolId)
    if (existingTab) {
      activeTabId.value = existingTab.id
      return
    }

    const newTab: Tab = {
      id: `${toolId}-${Date.now()}`,
      toolId,
      title: tool.name
    }
    tabs.value.push(newTab)
    activeTabId.value = newTab.id
  }

  function closeTab(tabId: string) {
    const index = tabs.value.findIndex(t => t.id === tabId)
    if (index === -1) return

    tabs.value.splice(index, 1)

    if (activeTabId.value === tabId && tabs.value.length > 0) {
      activeTabId.value = tabs.value[Math.min(index, tabs.value.length - 1)].id
    }
  }

  function setActiveTab(tabId: string) {
    activeTabId.value = tabId
  }

  /** 关闭除指定 tab 外的所有标签页 */
  function closeOtherTabs(tabId: string) {
    tabs.value = tabs.value.filter(t => t.id === tabId)
    activeTabId.value = tabId
  }

  /** 关闭全部标签页 */
  function closeAllTabs() {
    tabs.value = []
    activeTabId.value = ''
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    openTool,
    closeTab,
    setActiveTab,
    closeOtherTabs,
    closeAllTabs
  }
})
