/**
 * 主题配置模型
 *
 * 一个主题 = 6 处背景图 + 一组主题色，可命名保存、一键切换。
 * 背景图字段存完整的 CSS url() 值（默认主题为构建资源 URL，自定义主题为 data URL）。
 */

export interface ThemeConfig {
  id: string
  name: string
  /** 主画面整体背景底图 */
  mainBg: string
  /** 右下角背景图 */
  rightBottomBg: string
  /** 导航顶部图 */
  navTopBg: string
  /** 导航收折图（抽屉按钮） */
  navDrawerBg: string
  /** 导航菜单背景图 */
  navMenuBg: string
  /** 导航底部图 */
  navBottomBg: string
  /** 主题主色（按钮/高亮/激活态） */
  primaryColor: string
  /** 主色 hover 加深色 */
  primaryHover: string
  /** 侧边栏整体底色 */
  sidebarBg: string
  /** 导航内块背景色（header/nav/decor 底色） */
  navBlockBg: string
  /** 侧边栏文字强调色 */
  accentText: string
  /** 侧边栏文字弱色 */
  dimText: string
  /** 内容区背景色 */
  contentBg: string
}
