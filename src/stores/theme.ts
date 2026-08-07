import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ThemeConfig } from '@/types/theme'

// 默认主题的背景图（构建资源 URL）
import bgMainDefault from '@/assets/images/bg.webp'
import bgRightBottomDefault from '@/assets/images/bottom-right-bg.png'
import bgNavTopDefault from '@/assets/images/top-bg.png'
import bgNavDrawerDefault from '@/assets/icons/side-nav-drawer.png'
import bgNavMenuDefault from '@/assets/images/nav-bg.png'
import bgNavBottomDefault from '@/assets/images/mid-bottom-bg.webp'

/** CSS 变量 → ThemeConfig 字段的映射 */
const CSS_VAR_MAP: Record<keyof Omit<ThemeConfig, 'id' | 'name'>, string> = {
  mainBg: '--tusi-main-bg',
  rightBottomBg: '--tusi-right-bottom-bg',
  navTopBg: '--tusi-nav-top-bg',
  navDrawerBg: '--tusi-nav-drawer-bg',
  navMenuBg: '--tusi-nav-menu-bg',
  navBottomBg: '--tusi-nav-bottom-bg',
  primaryColor: '--tusi-primary',
  primaryHover: '--tusi-primary-hover',
  sidebarBg: '--tusi-sidebar-bg',
  navBlockBg: '--tusi-nav-block-bg',
  accentText: '--tusi-accent-text',
  dimText: '--tusi-dim-text',
  contentBg: '--tusi-content-bg'
}

const STORAGE_KEY = 'tusi:themes'
const ACTIVE_KEY = 'tusi:active-theme'

let seq = 0
const genId = () => `theme-${Date.now()}-${seq++}`

/** 内置默认主题（对应当前视觉效果） */
function buildDefaultTheme(): ThemeConfig {
  return {
    id: 'theme-default',
    name: '默认粉调',
    mainBg: `url("${bgMainDefault}")`,
    rightBottomBg: `url("${bgRightBottomDefault}")`,
    navTopBg: `url("${bgNavTopDefault}")`,
    navDrawerBg: `url("${bgNavDrawerDefault}")`,
    navMenuBg: `url("${bgNavMenuDefault}")`,
    navBottomBg: `url("${bgNavBottomDefault}")`,
    primaryColor: '#ff7eb6',
    primaryHover: '#ff5c9d',
    sidebarBg: '#201a1d',
    navBlockBg: '#101010',
    accentText: '#f5c6d6',
    dimText: '#e8b8cc',
    contentBg: 'rgba(255, 245, 248, 0.62)'
  }
}

export const useThemeStore = defineStore('theme', () => {
  /** 主题列表（首项为默认主题，不可删除） */
  const themes = ref<ThemeConfig[]>([])
  const activeThemeId = ref('')

  /** 应用主题：写入 CSS 自定义属性到 :root */
  function applyTheme(theme: ThemeConfig) {
    const root = document.documentElement
    const entries: [string, string][] = [
      [CSS_VAR_MAP.mainBg, theme.mainBg],
      [CSS_VAR_MAP.rightBottomBg, theme.rightBottomBg],
      [CSS_VAR_MAP.navTopBg, theme.navTopBg],
      [CSS_VAR_MAP.navDrawerBg, theme.navDrawerBg],
      [CSS_VAR_MAP.navMenuBg, theme.navMenuBg],
      [CSS_VAR_MAP.navBottomBg, theme.navBottomBg],
      [CSS_VAR_MAP.primaryColor, theme.primaryColor],
      [CSS_VAR_MAP.primaryHover, theme.primaryHover],
      [CSS_VAR_MAP.sidebarBg, theme.sidebarBg],
      [CSS_VAR_MAP.navBlockBg, theme.navBlockBg],
      [CSS_VAR_MAP.accentText, theme.accentText],
      [CSS_VAR_MAP.dimText, theme.dimText],
      [CSS_VAR_MAP.contentBg, theme.contentBg]
    ]
    for (const [key, value] of entries) {
      root.style.setProperty(key, value)
    }
    activeThemeId.value = theme.id
    persist()
  }

  /** 切换主题 */
  function switchTheme(id: string) {
    const theme = themes.value.find(t => t.id === id)
    if (!theme) return
    applyTheme(theme)
  }

  /** 新增主题（复制当前主题为基底） */
  function addTheme(name: string): ThemeConfig {
    const active = getActiveTheme()
    const theme: ThemeConfig = { ...active, id: genId(), name }
    themes.value.push(theme)
    return theme
  }

  /** 更新主题字段（编辑背景图/颜色），若为当前激活主题则即时生效 */
  function updateTheme(id: string, patch: Partial<ThemeConfig>) {
    const theme = themes.value.find(t => t.id === id)
    if (!theme) return
    Object.assign(theme, patch)
    if (id === activeThemeId.value) {
      applyTheme(theme)
    } else {
      persist()
    }
  }

  /** 删除非默认主题 */
  function removeTheme(id: string) {
    if (id === 'theme-default') return
    const index = themes.value.findIndex(t => t.id === id)
    if (index === -1) return
    themes.value.splice(index, 1)
    if (activeThemeId.value === id) {
      applyTheme(themes.value[0])
    } else {
      persist()
    }
  }

  /** 重命名主题 */
  function renameTheme(id: string, name: string) {
    updateTheme(id, { name })
  }

  /** 将主题的背景图与图标图全部恢复为默认图（主题色等其余字段不变） */
  function resetImagesToDefault(id: string) {
    const theme = themes.value.find(t => t.id === id)
    if (!theme) return
    const defaults = buildDefaultTheme()
    const patch: Partial<ThemeConfig> = {
      mainBg: defaults.mainBg,
      rightBottomBg: defaults.rightBottomBg,
      navTopBg: defaults.navTopBg,
      navDrawerBg: defaults.navDrawerBg,
      navMenuBg: defaults.navMenuBg,
      navBottomBg: defaults.navBottomBg
    }
    updateTheme(id, patch)
  }

  function getActiveTheme(): ThemeConfig {
    return themes.value.find(t => t.id === activeThemeId.value) ?? themes.value[0]
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(themes.value))
      localStorage.setItem(ACTIVE_KEY, activeThemeId.value)
    } catch {
      // 数据量过大时静默忽略
    }
  }

  /** 初始化：读取持久化主题；无则用默认主题 */
  function init() {
    const defaultTheme = buildDefaultTheme()
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const saved: ThemeConfig[] | null = raw ? JSON.parse(raw) : null
      const hasDefault = saved?.some(t => t.id === 'theme-default')
      themes.value = saved && saved.length
        ? hasDefault
          ? saved
          : [defaultTheme, ...saved]
        : [defaultTheme]
    } catch {
      themes.value = [defaultTheme]
    }

    const savedActive = localStorage.getItem(ACTIVE_KEY)
    const target = themes.value.find(t => t.id === savedActive) ?? themes.value[0]
    applyTheme(target)
  }

  return {
    themes,
    activeThemeId,
    init,
    applyTheme,
    switchTheme,
    addTheme,
    updateTheme,
    removeTheme,
    renameTheme,
    resetImagesToDefault,
    getActiveTheme
  }
})