import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 菜单图标覆盖 store
 *
 * 记录侧边栏每个分类 / 工具的图标是否为自定义。
 * 自定义图标保存到用户目录（tusi-img:// 协议路径），这里仅存路径，不存 base64，
 * 避免 localStorage 体积过大、且可保留动图。
 */
const STORAGE_KEY = 'tusi:menu-icons'

type IconKey = `category:${string}` | `tool:${string}`

function makeCategoryKey(id: string): IconKey {
  return `category:${id}`
}

function makeToolKey(id: string): IconKey {
  return `tool:${id}`
}

export const useMenuStore = defineStore('menu', () => {
  /** 覆盖记录：key → 自定义图标路径（tusi-img://...） */
  const customIcons = ref<Record<string, string>>({})

  /** 初始化：读取持久化的图标覆盖 */
  function init() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      customIcons.value = raw ? JSON.parse(raw) : {}
    } catch {
      customIcons.value = {}
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customIcons.value))
    } catch {
      // 数据量过大时静默忽略
    }
  }

  /** 取分类图标：有覆盖用覆盖，否则回退默认图标 */
  function getCategoryIcon(categoryId: string, defaultIcon: string): string {
    return customIcons.value[makeCategoryKey(categoryId)] ?? defaultIcon
  }

  /** 取工具图标：有覆盖用覆盖，否则回退默认图标 */
  function getToolIcon(toolId: string, defaultIcon: string): string {
    return customIcons.value[makeToolKey(toolId)] ?? defaultIcon
  }

  /** 是否自定义分类图标 */
  function isCategoryCustom(id: string): boolean {
    return makeCategoryKey(id) in customIcons.value
  }

  /** 是否自定义工具图标 */
  function isToolCustom(id: string): boolean {
    return makeToolKey(id) in customIcons.value
  }

  /** 设置分类自定义图标（iconPath 为 tusi-img:// 协议路径） */
  function setCategoryIcon(id: string, iconPath: string) {
    customIcons.value[makeCategoryKey(id)] = iconPath
    persist()
  }

  /** 设置工具自定义图标（iconPath 为 tusi-img:// 协议路径） */
  function setToolIcon(id: string, iconPath: string) {
    customIcons.value[makeToolKey(id)] = iconPath
    persist()
  }

  /** 恢复分类默认图标 */
  function resetCategoryIcon(id: string) {
    delete customIcons.value[makeCategoryKey(id)]
    persist()
  }

  /** 恢复工具默认图标 */
  function resetToolIcon(id: string) {
    delete customIcons.value[makeToolKey(id)]
    persist()
  }

  return {
    customIcons,
    init,
    getCategoryIcon,
    getToolIcon,
    isCategoryCustom,
    isToolCustom,
    setCategoryIcon,
    setToolIcon,
    resetCategoryIcon,
    resetToolIcon
  }
})