/**
 * 单位换算的类型定义。
 *
 * 设计取舍：换算关系用**可序列化的声明式数据**描述（而不是直接存函数），
 * 这样单位表可以像普通配置一样被校对、遍历和断言；
 * 只有真正无法用三种关系表达的单位才需要扩展 `UnitConv`。
 */

/** 与基准单位的换算关系 */
export type UnitConv =
  /** 线性：base = v × factor（绝大多数单位） */
  | { kind: 'linear'; factor: number }
  /** 仿射：base = v × a + b（温度，带偏移量） */
  | { kind: 'affine'; a: number; b: number }
  /** 倒数：base = k / v（油耗类，L/100km ↔ mpg 是除法而非乘法） */
  | { kind: 'reciprocal'; k: number }

export interface UnitDef {
  /** 分类内唯一标识，如 'in' */
  id: string
  /** 中文名，如 '英寸' */
  name: string
  /** 显示符号，如 'in' */
  symbol: string
  /** 搜索别名：英文名、复数、常见缩写 */
  aliases?: string[]
  conv: UnitConv
  /** 歧义提示，如加仑的美制/英制差异 */
  note?: string
}

export interface UnitCategory {
  id: string
  name: string
  /** 该分类默认选中 [左, 右] 两个单位 */
  defaults: [string, string]
  units: UnitDef[]
}
