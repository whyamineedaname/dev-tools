import { test } from 'node:test'
import assert from 'node:assert/strict'

import { UNIT_CATEGORIES, findUnit } from '@/config/units'
import {
  convert,
  convertText,
  formatNumber,
  needsApproxMarker,
  parseValue,
  searchUnits
} from '@/utils/unitConvert'
import type { UnitCategory, UnitDef } from '@/types/units'

// ============================================================================
// 单位换算断言表
//
// 这张表就是换算精度的验收标准：单位数据表是纯数据，最容易出的错是
//「系数写错一位」或「同名单位用错制式」，靠肉眼看是看不出来的。
// 运行：npm run test:units
// ============================================================================

function unit(categoryId: string, unitId: string): UnitDef {
  const found = findUnit(categoryId, unitId)
  assert.ok(found, `单位不存在：${categoryId}/${unitId}`)
  return found as UnitDef
}

function category(categoryId: string): UnitCategory {
  const found = UNIT_CATEGORIES.find(c => c.id === categoryId)
  assert.ok(found, `分类不存在：${categoryId}`)
  return found as UnitCategory
}

/** 相对误差比较 */
function near(actual: number, expected: number, rel = 1e-12, message = ''): void {
  const diff = Math.abs(actual - expected)
  const tolerance = Math.abs(expected) * rel
  assert.ok(
    diff <= tolerance,
    `${message} 期望 ${expected}，实际 ${actual}（差 ${diff}，容差 ${tolerance}）`
  )
}

/** 分类内单位换算 */
function conv(categoryId: string, fromId: string, toId: string, value = 1): number {
  return convert(value, unit(categoryId, fromId), unit(categoryId, toId))
}

// ==================== 1. 精确定义值 ====================

test('长度：定义值恒等式', () => {
  near(conv('length', 'in', 'mm'), 25.4, 1e-12, '1 in = 25.4 mm')
  near(conv('length', 'ft', 'cm'), 30.48, 1e-12, '1 ft = 30.48 cm')
  near(conv('length', 'yd', 'm'), 0.9144, 1e-12, '1 yd = 0.9144 m')
  near(conv('length', 'mi', 'm'), 1609.344, 1e-12, '1 mi = 1609.344 m')
  near(conv('length', 'nmi', 'm'), 1852, 1e-12, '1 nmi = 1852 m')
  near(conv('length', 'km', 'm'), 1000, 1e-12, '1 km = 1000 m')
})

test('长度：交叉自检（整数关系）', () => {
  near(conv('length', 'mi', 'in'), 63360, 1e-12, '1 mi = 63360 in')
  near(conv('length', 'mi', 'ft'), 5280, 1e-12, '1 mi = 5280 ft')
  near(conv('length', 'ft', 'in'), 12, 1e-12, '1 ft = 12 in')
  near(conv('length', 'nmi', 'm') / 1000, 1.852, 1e-12, '1 nmi = 1.852 km')
  near(conv('length', 'yd', 'ft'), 3, 1e-12, '1 yd = 3 ft')
})

test('面积：定义值与交叉自检', () => {
  near(conv('area', 'ha', 'm2'), 10000, 1e-12, '1 ha = 10000 m²')
  near(conv('area', 'ha', 'mu'), 15, 1e-12, '1 ha = 15 亩')
  near(conv('area', 'mu', 'm2'), 10000 / 15, 1e-12, '1 亩 = 666.67 m²')
  near(conv('area', 'mu', 'fen'), 10, 1e-12, '1 亩 = 10 分')
  near(conv('area', 'acre', 'm2'), 4046.8564224, 1e-12, '1 acre = 4046.8564224 m²')
  near(conv('area', 'acre', 'ft2'), 43560, 1e-9, '1 acre = 43560 ft²')
})

test('体积：定义值与交叉自检', () => {
  near(conv('volume', 'l', 'ml'), 1000, 1e-12, '1 L = 1000 mL')
  near(conv('volume', 'm3', 'l'), 1000, 1e-12, '1 m³ = 1000 L')
  near(conv('volume', 'usgal', 'l'), 3.785411784, 1e-12, '1 US gal = 3.785411784 L')
  near(conv('volume', 'ukgal', 'l'), 4.54609, 1e-12, '1 UK gal = 4.54609 L')
  near(conv('volume', 'usgal', 'usfloz'), 128, 1e-12, '1 US gal = 128 US fl oz')
  near(conv('volume', 'ukgal', 'ukfloz'), 160, 1e-12, '1 UK gal = 160 UK fl oz')
  near(conv('volume', 'bbl', 'usgal'), 42, 1e-12, '1 桶 = 42 US gal')
  assert.ok(
    conv('volume', 'ukgal', 'l') > conv('volume', 'usgal', 'l'),
    '英制加仑必须大于美制加仑'
  )
})

test('质量：定义值与交叉自检', () => {
  near(conv('mass', 'lb', 'g'), 453.59237, 1e-12, '1 lb = 453.59237 g')
  near(conv('mass', 'oz', 'g'), 28.349523125, 1e-12, '1 oz = 28.349523125 g')
  near(conv('mass', 'lb', 'oz'), 16, 1e-12, '1 lb = 16 oz')
  near(conv('mass', 'ozt', 'g'), 31.1034768, 1e-12, '1 金衡盎司 = 31.1034768 g')
  near(conv('mass', 'jin', 'g'), 500, 1e-12, '1 斤 = 500 g')
  near(conv('mass', 'jin', 'liang'), 10, 1e-12, '1 斤 = 10 两')
  near(conv('mass', 'dan', 'jin'), 100, 1e-12, '1 担 = 100 斤')
  near(conv('mass', 'ct', 'mg'), 200, 1e-12, '1 克拉 = 200 mg')
  near(conv('mass', 'longton', 'lb'), 2240, 1e-12, '1 长吨 = 2240 lb')
  near(conv('mass', 'shortton', 'lb'), 2000, 1e-12, '1 短吨 = 2000 lb')
  assert.ok(
    conv('mass', 'ozt', 'g') > conv('mass', 'oz', 'g'),
    '金衡盎司必须重于常衡盎司'
  )
})

test('压力：定义值恒等式', () => {
  near(conv('pressure', 'atm', 'pa'), 101325, 1e-12, '1 atm = 101325 Pa')
  near(conv('pressure', 'bar', 'pa'), 100000, 1e-12, '1 bar = 100000 Pa')
  near(conv('pressure', 'psi', 'pa'), 6894.757293168361, 1e-12, '1 psi')
  near(conv('pressure', 'mmhg', 'pa'), 133.322387415, 1e-12, '1 mmHg')
  near(conv('pressure', 'kgfcm2', 'pa'), 98066.5, 1e-12, '1 kgf/cm²')
  near(conv('pressure', 'mbar', 'pa'), 100, 1e-12, '1 mbar = 100 Pa')
})

test('能量：定义值恒等式', () => {
  near(conv('energy', 'kwh', 'j'), 3600000, 1e-12, '1 kWh = 3.6 MJ')
  near(conv('energy', 'kcal', 'j'), 4184, 1e-12, '1 kcal = 4184 J')
  near(conv('energy', 'cal', 'j'), 4.184, 1e-12, '1 cal = 4.184 J')
  near(conv('energy', 'kcal', 'cal'), 1000, 1e-12, '1 kcal = 1000 cal')
  near(conv('energy', 'wh', 'j'), 3600, 1e-12, '1 Wh = 3600 J')
  near(conv('energy', 'btu', 'j'), 1055.05585262, 1e-12, '1 BTU(IT)')
  near(conv('energy', 'ev', 'j'), 1.602176634e-19, 1e-9, '1 eV')
})

test('功率：三种马力必须区分', () => {
  near(conv('power', 'hp', 'w'), 745.6998715822702, 1e-12, '机械马力')
  near(conv('power', 'ps', 'w'), 735.49875, 1e-12, '公制马力')
  near(conv('power', 'hpe', 'w'), 746, 1e-12, '电气马力')
  near(conv('power', 'kw', 'w'), 1000, 1e-12, '1 kW = 1000 W')
  near(conv('power', 'btuh', 'w'), 0.2930710701722222, 1e-12, '1 BTU/h')
  near(conv('power', 'rt', 'btuh'), 12000, 1e-9, '1 冷吨 = 12000 BTU/h')
})

test('力与力矩：定义值恒等式', () => {
  near(conv('force', 'kgf', 'n'), 9.80665, 1e-12, '1 kgf = 9.80665 N')
  near(conv('force', 'lbf', 'n'), 4.4482216152605, 1e-12, '1 lbf')
  near(conv('force', 'kn', 'n'), 1000, 1e-12, '1 kN = 1000 N')
  near(conv('force', 'dyn', 'n'), 1e-5, 1e-12, '1 dyn = 1e-5 N')
  near(conv('torque', 'kgfm', 'nm'), 9.80665, 1e-12, '1 kgf·m = 9.80665 N·m')
  near(conv('torque', 'lbfft', 'nm'), 1.3558179483314004, 1e-12, '1 lbf·ft')
  near(conv('torque', 'lbfft', 'lbfin'), 12, 1e-9, '1 lbf·ft = 12 lbf·in')
  near(conv('torque', 'kgfm', 'kgfcm'), 100, 1e-12, '1 kgf·m = 100 kgf·cm')
})

test('速度与角度：定义值恒等式', () => {
  near(conv('speed', 'kn', 'kmh'), 1.852, 1e-12, '1 节 = 1.852 km/h')
  near(conv('speed', 'mph', 'ms'), 0.44704, 1e-12, '1 mph')
  near(conv('speed', 'kmh', 'ms'), 1 / 3.6, 1e-12, '1 km/h')
  near(conv('angle', 'turn', 'deg'), 360, 1e-12, '1 圈 = 360°')
  near(conv('angle', 'deg', 'arcmin'), 60, 1e-12, '1° = 60′')
  near(conv('angle', 'deg', 'arcsec'), 3600, 1e-12, '1° = 3600″')
  near(conv('angle', 'milnato', 'deg') * 6400, 360, 1e-12, '北约密位')
  near(conv('angle', 'milru', 'deg') * 6000, 360, 1e-12, '华约密位')
  near(conv('angle', 'rad', 'deg'), 180 / Math.PI, 1e-12, 'π rad = 180°')
})

test('存储容量：十进制与二进制两套并存', () => {
  near(conv('data', 'kb', 'byte'), 1000, 1e-12, '1 KB = 1000 B（SI）')
  near(conv('data', 'kib', 'byte'), 1024, 1e-12, '1 KiB = 1024 B（IEC）')
  near(conv('data', 'gib', 'mib'), 1024, 1e-12, '1 GiB = 1024 MiB')
  near(conv('data', 'byte', 'bit'), 8, 1e-12, '1 B = 8 bit')
  near(conv('data', 'tb', 'gib'), 931.3225746154785, 1e-12, '1 TB = 931.32 GiB（硬盘容量困惑的来源）')
})

test('数据速率：bit 与 Byte 相差 8 倍', () => {
  near(conv('datarate', 'mbps', 'mbs'), 0.125, 1e-12, '1 Mbit/s = 0.125 MB/s')
  near(conv('datarate', 'mbps', 'bps'), 1e6, 1e-12, '1 Mbit/s = 1e6 bit/s')
  near(conv('datarate', 'gbs', 'mbs'), 1000, 1e-12, '1 GB/s = 1000 MB/s')
  near(conv('datarate', 'mbs', 'bs'), 1e6, 1e-12, '1 MB/s = 1e6 B/s')
})

test('时间：约定必须明确', () => {
  near(conv('time', 'h', 'min'), 60, 1e-12, '1 h = 60 min')
  near(conv('time', 'day', 'h'), 24, 1e-12, '1 d = 24 h')
  near(conv('time', 'week', 'day'), 7, 1e-12, '1 周 = 7 天')
  near(conv('time', 'year', 'day'), 365.2425, 1e-12, '格里高利年 = 365.2425 天')
  near(conv('time', 'yearj', 'day'), 365.25, 1e-12, '儒略年 = 365.25 天')
  near(conv('time', 'year', 'month'), 12, 1e-9, '1 年 = 12 个平均月')
})

// ==================== 2. 温度（仿射关系） ====================

test('温度：仿射关系与锚点自检', () => {
  near(conv('temperature', 'c', 'f', -40), -40, 1e-12, '-40 °C = -40 °F（唯一交点）')
  near(conv('temperature', 'c', 'f', 0), 32, 1e-12, '0 °C = 32 °F')
  near(conv('temperature', 'c', 'f', 100), 212, 1e-12, '100 °C = 212 °F')
  near(conv('temperature', 'c', 'k', 0), 273.15, 1e-12, '0 °C = 273.15 K')
  near(conv('temperature', 'c', 'k', 100), 373.15, 1e-12, '100 °C = 373.15 K')
  near(conv('temperature', 'k', 'c', 0), -273.15, 1e-12, '绝对零度')
  near(conv('temperature', 'f', 'k', 32), 273.15, 1e-12, '32 °F = 273.15 K')
  near(conv('temperature', 'k', 'r', 0), 0, 1e-12, '0 K = 0 °R')
  near(conv('temperature', 'c', 'r', 0), 491.67, 1e-9, '0 °C = 491.67 °R')
})

// ==================== 3. 油耗（倒数关系，最易写错） ====================

test('油耗：必须是除法，不是乘法', () => {
  const per100 = convert(8, unit('fuel', 'l100'), unit('fuel', 'mpgus'))
  near(per100, 235.21458333333334 / 8, 1e-12, '8 L/100km ≈ 29.4 mpg(US)')
  near(per100, 29.401822916666668, 1e-12, '8 L/100km 的具体值')

  const multiplied = 8 * 235.21458333333334
  assert.ok(
    Math.abs(per100 - multiplied) > 1,
    `油耗换算若写成乘法会得到 ${multiplied}，与正确的 ${per100} 相差悬殊`
  )

  near(convert(30, unit('fuel', 'mpgus'), unit('fuel', 'l100')), 7.840486111111111, 1e-12, '30 mpg ≈ 7.84 L/100km')
  near(conv('fuel', 'l100', 'kml', 8), 12.5, 1e-12, '8 L/100km = 12.5 km/L')
  near(conv('fuel', 'kml', 'l100', 20), 5, 1e-12, '20 km/L = 5 L/100km')
  assert.ok(
    conv('fuel', 'l100', 'mpguk', 8) > conv('fuel', 'l100', 'mpgus', 8),
    '同一油耗下 mpg(UK) 数值必须高于 mpg(US)'
  )
})

// ==================== 4. 全表往返（属性测试） ====================

test('全表往返：任意两单位互转再转回必须还原', () => {
  for (const cat of UNIT_CATEGORIES) {
    for (const from of cat.units) {
      for (const to of cat.units) {
        const forward = convert(1, from, to)
        assert.ok(
          Number.isFinite(forward),
          `${cat.name}：${from.id} → ${to.id} 结果不是有限数`
        )
        const back = convert(forward, to, from)
        near(back, 1, 1e-9, `${cat.name}：${from.id} → ${to.id} → ${from.id} 未还原`)
      }
    }
  }
})

test('全表往返：负值与多组取值同样成立', () => {
  for (const cat of UNIT_CATEGORIES) {
    for (const from of cat.units) {
      for (const to of cat.units) {
        for (const value of [-40, 0.001, 123.456]) {
          const back = convert(convert(value, from, to), to, from)
          near(back, value, 1e-9, `${cat.name}：${from.id}→${to.id} 值 ${value} 未还原`)
        }
      }
    }
  }
})

test('倒数单位：0 值应明确失败而不是返回 Infinity', () => {
  const mpg = unit('fuel', 'mpgus')
  assert.ok(Number.isNaN(convert(0, unit('fuel', 'l100'), mpg)), '0 油耗换算为 mpg 应为 NaN')
})

// ==================== 5. 数据表完整性 ====================

test('数据表：分类与单位结构完整', () => {
  assert.ok(UNIT_CATEGORIES.length >= 15, `分类数偏少：${UNIT_CATEGORIES.length}`)
  const categoryIds = new Set<string>()

  for (const cat of UNIT_CATEGORIES) {
    assert.ok(cat.id && cat.name, '分类必须有 id 与 name')
    assert.ok(!categoryIds.has(cat.id), `分类 id 重复：${cat.id}`)
    categoryIds.add(cat.id)

    assert.ok(cat.units.length >= 2, `${cat.name} 至少需要 2 个单位`)

    const ids = new Set<string>()
    const symbols = new Set<string>()
    for (const unitDef of cat.units) {
      assert.ok(unitDef.id && unitDef.name && unitDef.symbol, `${cat.name} 存在字段缺失的单位`)
      assert.ok(!ids.has(unitDef.id), `${cat.name} 单位 id 重复：${unitDef.id}`)
      assert.ok(!symbols.has(unitDef.symbol), `${cat.name} 单位符号重复：${unitDef.symbol}`)
      ids.add(unitDef.id)
      symbols.add(unitDef.symbol)

      const conv2 = unitDef.conv
      if (conv2.kind === 'linear') {
        assert.ok(Number.isFinite(conv2.factor) && conv2.factor !== 0, `${unitDef.id} 系数非法`)
      } else if (conv2.kind === 'affine') {
        assert.ok(Number.isFinite(conv2.a) && conv2.a !== 0, `${unitDef.id} 仿射系数非法`)
        assert.ok(Number.isFinite(conv2.b), `${unitDef.id} 仿射偏移非法`)
      } else {
        assert.ok(Number.isFinite(conv2.k) && conv2.k !== 0, `${unitDef.id} 倒数系数非法`)
      }
    }

    for (const defaultId of cat.defaults) {
      assert.ok(ids.has(defaultId), `${cat.name} 默认单位不存在：${defaultId}`)
    }
    assert.notEqual(cat.defaults[0], cat.defaults[1], `${cat.name} 默认两侧单位不能相同`)
  }
})

test('数据表：歧义单位必须带制式后缀与说明', () => {
  const ambiguous: Array<[string, string]> = [
    ['volume', 'usgal'],
    ['volume', 'ukgal'],
    ['mass', 'oz'],
    ['mass', 'ozt'],
    ['mass', 'ct'],
    ['power', 'hp'],
    ['power', 'ps'],
    ['power', 'hpe'],
    ['fuel', 'mpgus'],
    ['fuel', 'mpguk'],
    ['data', 'kb'],
    ['data', 'gib'],
    ['angle', 'milnato'],
    ['angle', 'milru'],
    ['time', 'month'],
    ['time', 'year']
  ]
  for (const [catId, unitId] of ambiguous) {
    const target = unit(catId, unitId)
    assert.ok(target.note, `${catId}/${unitId} 存在歧义，必须写 note 说明`)
  }
})

// ==================== 6. 格式化 ====================

test('格式化：消除浮点末位噪声', () => {
  assert.equal(formatNumber(63360.00000000001), '63360', '1 mi → in 不能显示成一长串 9')
  assert.equal(formatNumber(25.400000000000002), '25.4')
  assert.equal(formatNumber(0.30000000000000004), '0.3')
  assert.equal(formatNumber(1 / 3), '0.333333')
  assert.equal(formatNumber(666.6666666666666), '666.667')
  assert.equal(formatNumber(31557600), '31557600', '整数不应变成科学计数法')
  assert.equal(formatNumber(0.0001), '0.0001')
})

test('格式化：科学计数法与特殊值', () => {
  assert.equal(formatNumber(9.4607304725808e15), '9.46073×10¹⁵')
  assert.equal(formatNumber(1e-9), '1×10⁻⁹')
  assert.equal(formatNumber(3.0856775814913673e16), '3.08568×10¹⁶')
  assert.equal(formatNumber(0), '0')
  assert.equal(formatNumber(NaN), '—')
  assert.equal(formatNumber(Infinity), '—')
  assert.equal(formatNumber(-0.5), '-0.5')
})

test('格式化：科学计数法阈值不受浮点误差影响', () => {
  // 1 m = 1e9 nm，浮点算出来是 999999999.9999999，两种输入必须显示一致
  assert.equal(formatNumber(1e9), '1×10⁹')
  assert.equal(formatNumber(999999999.9999999), '1×10⁹')
  assert.equal(formatNumber(1e-5), '1×10⁻⁵')
  assert.equal(formatNumber(0.000393701), '0.000393701')
  assert.equal(formatNumber(0.0001), '0.0001')
})

test('格式化：整数部分不截断，避免把精确值改成近似值', () => {
  assert.equal(formatNumber(1234567), '1234567')
  assert.equal(formatNumber(31557600), '31557600')
  assert.equal(formatNumber(5280), '5280')
})

test('格式化：千分位与约等号判定', () => {
  assert.equal(formatNumber(1234567, 6, true), '1,234,567')
  assert.equal(formatNumber(1234567.891, 8, true), '1,234,567.9')

  assert.equal(needsApproxMarker(25.4), false, '精确值不应标 ≈')
  assert.equal(needsApproxMarker(63360.00000000001), false, '浮点噪声不应标 ≈')
  assert.equal(needsApproxMarker(1 / 3), true, '需要四舍五入时应标 ≈')
  assert.equal(needsApproxMarker(666.6666666666666), true)
})

// ==================== 7. 输入解析 ====================

test('解析：数字、千分位、科学计数法、分数', () => {
  const inch = unit('length', 'in')
  assert.equal((parseValue('1,234.5', inch) as { value: number }).value, 1234.5)
  assert.equal((parseValue('1e-3', inch) as { value: number }).value, 0.001)
  assert.equal((parseValue('3/8', inch) as { value: number }).value, 0.375)
  assert.equal((parseValue(' 42 ', inch) as { value: number }).value, 42)
  assert.equal((parseValue('-7.5', inch) as { value: number }).value, -7.5)
})

test('解析：英尺英寸与全角字符', () => {
  const cm = unit('length', 'cm')
  const inch = unit('length', 'in')

  near((parseValue(`5'11"`, cm) as { value: number }).value, 180.34, 1e-9, `5'11" = 180.34 cm`)
  near((parseValue(`5'11`, cm) as { value: number }).value, 180.34, 1e-9, '省略英寸符号也成立')
  near((parseValue('5 ft 11 in', cm) as { value: number }).value, 180.34, 1e-9, '英文写法')
  near((parseValue(`6'`, cm) as { value: number }).value, 182.88, 1e-9, '只写英尺')
  near((parseValue(`5'11"`, inch) as { value: number }).value, 71, 1e-9, '换成英寸应为 71')

  assert.equal((parseValue('５．５', inch) as { value: number }).value, 5.5, '全角数字与小数点')
})

test('解析：非法输入必须报错而不是静默当 0', () => {
  const inch = unit('length', 'in')
  assert.equal(parseValue('abc', inch).ok, false)
  assert.equal(parseValue('3/0', inch).ok, false)
  assert.equal(parseValue('', inch).ok, false)
  assert.equal(parseValue('--1', inch).ok, false)
  assert.equal((parseValue('abc', inch) as { error: string }).error, '无法识别的数值')
  assert.equal((parseValue('3/0', inch) as { error: string }).error, '分母不能为 0')
})

// ==================== 8. 界面入口 ====================

test('convertText：解析、换算、格式化、换算率一次到位', () => {
  const inch = unit('length', 'in')
  const mm = unit('length', 'mm')
  const m = unit('length', 'm')
  const ft = unit('length', 'ft')

  const exact = convertText('1', inch, mm)
  assert.equal(exact.ok, true)
  assert.equal(exact.text, '25.4')
  assert.equal(exact.approx, false, '1 in = 25.4 mm 是精确定义值')
  assert.equal(exact.rate, '25.4')

  const approx = convertText('1', m, ft)
  assert.equal(approx.text, '3.28084')
  assert.equal(approx.approx, true, '1 m 换算成英尺需要四舍五入')

  const failed = convertText('abc', inch, mm)
  assert.equal(failed.ok, false)
  assert.equal(failed.text, '')
  assert.equal(failed.error, '无法识别的数值')
  assert.equal(failed.rate, '25.4', '即使输入非法，换算率仍应可用')
})

test('convertText：精度选项生效', () => {
  const m = unit('length', 'm')
  const ft = unit('length', 'ft')
  assert.equal(convertText('1', m, ft, 3).text, '3.28')
  assert.equal(convertText('1', m, ft, 9).text, '3.2808399')
})

// ==================== 9. 别名搜索 ====================

test('搜索：中英文与别名都能命中', () => {
  const mass = category('mass').units
  assert.equal(searchUnits(mass, 'lb')[0].id, 'lb')
  assert.equal(searchUnits(mass, 'lbs')[0].id, 'lb')
  assert.equal(searchUnits(mass, 'pound')[0].id, 'lb')
  assert.equal(searchUnits(mass, '磅')[0].id, 'lb')
  assert.equal(searchUnits(mass, '公斤')[0].id, 'kg')
  assert.equal(searchUnits(mass, 'oz')[0].id, 'oz', 'oz 应命中常衡盎司而不是金衡')
  assert.equal(searchUnits(mass, 'ozt')[0].id, 'ozt')
  assert.equal(searchUnits(mass, '盎司(金衡)')[0].id, 'ozt')
  assert.equal(searchUnits(mass, '').length, mass.length, '空查询返回全部且保持顺序')
  assert.equal(searchUnits(mass, 'zzz').length, 0, '无匹配应返回空数组')
})

test('搜索：中文名与符号都能搜到', () => {
  const length = category('length').units
  assert.equal(searchUnits(length, '英寸')[0].id, 'in')
  assert.equal(searchUnits(length, 'inch')[0].id, 'in')
  assert.equal(searchUnits(length, 'mm')[0].id, 'mm')
  assert.equal(searchUnits(length, '光年')[0].id, 'ly')
})

// ==================== 10. 界面入口的整表一致性 ====================

test('每个分类的默认单位对都能正常互转', () => {
  for (const cat of UNIT_CATEGORIES) {
    const [leftId, rightId] = cat.defaults
    const outcome = convertText('1', unit(cat.id, leftId), unit(cat.id, rightId))
    assert.equal(outcome.ok, true, `${cat.name} 默认单位对换算失败`)
    assert.ok(outcome.text.length > 0, `${cat.name} 默认换算结果为空`)
    assert.notEqual(outcome.text, '—', `${cat.name} 默认换算结果为 —`)
  }
})
