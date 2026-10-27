import type { UnitDef } from '@/types/units'

// ============================================================================
// 单位换算核心
//
// 三层结构：
//   1. toBase / fromBase —— 单位与「分类基准单位」之间的双向映射；
//   2. convert           —— 任意两单位互转 = fromBase(to, toBase(from, v))，
//                           天然可逆，是非线性单位（温度 / 油耗）唯一正确的做法；
//   3. convertText       —— 面向界面：解析用户输入 → 换算 → 格式化，一次到位。
//
// 精度策略：用 float64 计算，但输出端按**有效数字**收敛。
// 单位表里的系数本身都是精确定义值，浮点误差只体现在末位，
// 收敛后即可消除（例如 1 mi → in 的 63360.00000000001 显示为 63360）。
// ============================================================================

export type ParseResult = { ok: true; value: number } | { ok: false; error: string }

export interface ConversionOutcome {
  ok: boolean
  value: number
  /** 面向界面的文本；失败时为 '—' */
  text: string
  /** 是否因四舍五入而需要显示约等号 */
  approx: boolean
  /** 展示用的「1 左 = ? 右」换算率 */
  rate: string
  rateApprox: boolean
  error?: string
}

const EM_DASH = '—'

// ==================== 基础映射 ====================

/** 单位值 → 本分类基准单位值 */
export function toBase(unit: UnitDef, value: number): number {
  const conv = unit.conv
  if (conv.kind === 'linear') return value * conv.factor
  if (conv.kind === 'affine') return value * conv.a + conv.b
  if (value === 0) return NaN
  return conv.k / value
}

/** 本分类基准单位值 → 单位值 */
export function fromBase(unit: UnitDef, base: number): number {
  const conv = unit.conv
  if (conv.kind === 'linear') return base / conv.factor
  if (conv.kind === 'affine') return (base - conv.b) / conv.a
  if (base === 0) return NaN
  return conv.k / base
}

/** 任意两单位互转 */
export function convert(value: number, from: UnitDef, to: UnitDef): number {
  return fromBase(to, toBase(from, value))
}

// ==================== 数值格式化 ====================

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': ''
}

function toSuperscript(exp: number): string {
  return String(exp).split('').map(ch => SUPERSCRIPT[ch] ?? ch).join('')
}

/** 去掉小数末尾多余的 0（整数与科学计数法尾数都不动） */
function trimZeros(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}

function addSeparators(text: string): string {
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const [intPart, decimalPart] = body.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${decimalPart ? `.${decimalPart}` : ''}`
}

/**
 * 按有效数字格式化。
 * 过大 / 过小的数值切科学计数法（纳米、光年等场景必需）。
 *
 * 阈值判断刻意基于**按有效数字舍入后**的指数，而不是 Math.log10：
 * 1 m = 1e9 nm 在浮点下算出来是 999999999.9999999，用 log10 判断会掉到
 * 科学计数法阈值之外，出现「同一个真值两种写法」的不一致。
 */
export function formatNumber(value: number, sig = 6, group = false): string {
  if (!Number.isFinite(value)) return EM_DASH
  if (value === 0) return '0'

  // 定点显示窗口：指数在 [-4, 8] 之间用普通小数，其余用科学计数法
  const exponential = value.toExponential(Math.max(0, sig - 1))
  const [mantissa, expPart] = exponential.split('e')
  const exponent = Number(expPart)

  if (exponent >= 9 || exponent < -4) {
    return `${trimZeros(mantissa)}×10${toSuperscript(exponent)}`
  }

  // 定点：按有效数字反推小数位，整数部分不截断（避免把精确整数改成近似值）
  const decimals = Math.min(100, Math.max(0, sig - 1 - exponent))
  const fixed = trimZeros(value.toFixed(decimals))
  return group ? addSeparators(fixed) : fixed
}

/** 显示值是否经过了四舍五入（用于决定要不要标 ≈；浮点末位噪声不算） */
export function needsApproxMarker(value: number, sig = 6): boolean {
  if (!Number.isFinite(value) || value === 0) return false
  const quantized = Number(value.toPrecision(sig))
  if (quantized === value) return false
  return Math.abs(quantized - value) > Math.abs(value) * 1e-14
}

// ==================== 输入解析 ====================

/** 全角转半角：中文输入法下很容易打出全角数字与符号 */
function normalizeInput(raw: string): string {
  return String(raw ?? '')
    .replace(/[\uff10-\uff19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\uff0e/g, '.')
    .replace(/\uff0f/g, '/')
    .replace(/\uff0d/g, '-')
    .replace(/\u3000/g, ' ')
    .trim()
}

/** 5'11" / 5′11″ / 5 ft 11 in —— 英尺英寸写法 */
const FEET_INCH_RE =
  /^(-?\d+(?:\.\d+)?)\s*(?:'|′|ft|英尺|foot|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|in|英寸|inch|inches)?)?$/i

/** 3/8 —— 分数写法（英寸常用） */
const FRACTION_RE = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/

/**
 * 解析用户输入为「当前单位下的数值」。
 * 支持：千分位逗号、科学计数法、分数、英尺英寸、全角字符。
 */
export function parseValue(raw: string, unit: UnitDef): ParseResult {
  const text = normalizeInput(raw)
  if (!text) return { ok: false, error: '' }

  // 英尺英寸：先算成米，再折回当前单位（这样 °C 之类的单位也不会被误用）
  const feetInch = text.match(FEET_INCH_RE)
  if (feetInch) {
    const sign = feetInch[1].startsWith('-') ? -1 : 1
    const feet = Math.abs(Number(feetInch[1]))
    const inch = feetInch[2] === undefined ? 0 : Number(feetInch[2])
    const meters = sign * (feet * 0.3048 + inch * 0.0254)
    const value = fromBase(unit, meters)
    if (!Number.isFinite(value)) return { ok: false, error: '无法换算该数值' }
    return { ok: true, value }
  }

  const cleaned = text.replace(/[,\s_]/g, '')

  const fraction = cleaned.match(FRACTION_RE)
  if (fraction) {
    const numerator = Number(fraction[1])
    const denominator = Number(fraction[2])
    if (denominator === 0) return { ok: false, error: '分母不能为 0' }
    return { ok: true, value: numerator / denominator }
  }

  const value = Number(cleaned)
  if (!Number.isFinite(value)) return { ok: false, error: '无法识别的数值' }
  return { ok: true, value }
}

// ==================== 界面入口 ====================

/**
 * 一次完成「解析输入 → 换算 → 格式化」，并把换算率一并返回。
 * 界面层只负责把 text 填进另一侧，不需要关心上面任何细节。
 */
export function convertText(
  raw: string,
  from: UnitDef,
  to: UnitDef,
  sig = 6
): ConversionOutcome {
  const rateValue = convert(1, from, to)
  const rate = formatNumber(rateValue, sig)
  const rateApprox = needsApproxMarker(rateValue, sig)

  const parsed = parseValue(raw, from)
  if (!parsed.ok) {
    return { ok: false, value: NaN, text: '', approx: false, rate, rateApprox, error: parsed.error }
  }

  const value = convert(parsed.value, from, to)
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      value: NaN,
      text: '',
      approx: false,
      rate,
      rateApprox,
      error: '该单位不支持 0（倒数关系）'
    }
  }

  return {
    ok: true,
    value,
    text: formatNumber(value, sig),
    approx: needsApproxMarker(value, sig),
    rate,
    rateApprox
  }
}

// ==================== 单位搜索 ====================

function normalizeText(text: string): string {
  return normalizeInput(text).toLowerCase()
}

function matchScore(unit: UnitDef, query: string): number {
  const id = normalizeText(unit.id)
  const symbol = normalizeText(unit.symbol)
  const name = normalizeText(unit.name)
  const aliases = (unit.aliases ?? []).map(normalizeText)

  if (id === query || symbol === query || name === query) return 100
  if (aliases.includes(query)) return 90
  if (name.startsWith(query)) return 80
  if (aliases.some(alias => alias.startsWith(query))) return 70
  if (id.startsWith(query) || symbol.startsWith(query)) return 60
  if (name.includes(query)) return 50
  if (aliases.some(alias => alias.includes(query))) return 40
  if (id.includes(query) || symbol.includes(query)) return 30
  return 0
}

/**
 * 别名搜索：`lb` / `lbs` / `pound` / `磅` 命中同一个单位。
 * 空查询返回原顺序。
 */
export function searchUnits(units: UnitDef[], query: string): UnitDef[] {
  const keyword = normalizeText(query)
  if (!keyword) return units
  return units
    .map((unit, index) => ({ unit, index, score: matchScore(unit, keyword) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(row => row.unit)
}
