import type { UnitCategory, UnitConv } from '@/types/units'

// ============================================================================
// 单位换算数据表
//
// 约定：
// 1. 每个分类有一个隐含的“基准单位”（写在注释里），单位只声明与基准的关系；
// 2. 系数一律使用**精确定义值**（如 1 in = 0.0254 m 是国际协议定义值），
//    不用测量值，也不自行截断——截断会破坏“1 mi = 63360 in”这类交叉校验；
// 3. 有歧义的同名单位必须带制式后缀（加仑(US) / 盎司(金衡) / 马力(公制)），
//    并在 note 里说明差异，避免用户选错；
// 4. 改这张表后必须跑 `npm run test:units`，断言表会校验全表自洽性。
// ============================================================================

const lin = (factor: number): UnitConv => ({ kind: 'linear', factor })
const aff = (a: number, b: number): UnitConv => ({ kind: 'affine', a, b })
const rec = (k: number): UnitConv => ({ kind: 'reciprocal', k })

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    id: 'length',
    name: '长度',
    defaults: ['cm', 'in'],
    units: [
      // 基准：米 m
      { id: 'm', name: '米', symbol: 'm', conv: lin(1), aliases: ['meter', 'metre', 'meters', '米'] },
      { id: 'km', name: '千米', symbol: 'km', conv: lin(1000), aliases: ['kilometer', '公里', 'km'] },
      { id: 'dm', name: '分米', symbol: 'dm', conv: lin(0.1), aliases: ['decimeter'] },
      { id: 'cm', name: '厘米', symbol: 'cm', conv: lin(0.01), aliases: ['centimeter', '公分', 'cm'] },
      { id: 'mm', name: '毫米', symbol: 'mm', conv: lin(0.001), aliases: ['millimeter', '毫米', 'mm'] },
      { id: 'um', name: '微米', symbol: 'µm', conv: lin(1e-6), aliases: ['micrometer', 'micron'] },
      { id: 'nm', name: '纳米', symbol: 'nm', conv: lin(1e-9), aliases: ['nanometer'] },
      { id: 'mi', name: '英里', symbol: 'mi', conv: lin(1609.344), aliases: ['mile', 'miles', '英里'] },
      { id: 'yd', name: '码', symbol: 'yd', conv: lin(0.9144), aliases: ['yard', 'yards', '码'] },
      { id: 'ft', name: '英尺', symbol: 'ft', conv: lin(0.3048), aliases: ['foot', 'feet', '英尺'] },
      { id: 'in', name: '英寸', symbol: 'in', conv: lin(0.0254), aliases: ['inch', 'inches', '英寸'] },
      { id: 'nmi', name: '海里', symbol: 'nmi', conv: lin(1852), aliases: ['nautical mile', '海里'] },
      { id: 'li', name: '市里', symbol: '里', conv: lin(500), aliases: ['里', '华里'], note: '1 市里 = 500 m' },
      { id: 'zhang', name: '丈', symbol: '丈', conv: lin(10 / 3), aliases: ['丈'], note: '1 丈 = 10/3 m' },
      { id: 'chi', name: '市尺', symbol: '尺', conv: lin(1 / 3), aliases: ['尺', '市尺'], note: '1 市尺 = 1/3 m' },
      { id: 'cun', name: '市寸', symbol: '寸', conv: lin(1 / 30), aliases: ['寸', '市寸'], note: '1 市寸 = 1/30 m' },
      { id: 'au', name: '天文单位', symbol: 'AU', conv: lin(1.495978707e11), aliases: ['astronomical unit'] },
      { id: 'ly', name: '光年', symbol: 'ly', conv: lin(9.4607304725808e15), aliases: ['light year', '光年'] },
      { id: 'pc', name: '秒差距', symbol: 'pc', conv: lin(3.0856775814913673e16), aliases: ['parsec'] }
    ]
  },
  {
    id: 'area',
    name: '面积',
    defaults: ['m2', 'mu'],
    units: [
      // 基准：平方米 m²
      { id: 'm2', name: '平方米', symbol: 'm²', conv: lin(1), aliases: ['square meter', '平米', '平方'] },
      { id: 'km2', name: '平方千米', symbol: 'km²', conv: lin(1e6), aliases: ['square kilometer', '平方公里'] },
      { id: 'cm2', name: '平方厘米', symbol: 'cm²', conv: lin(1e-4), aliases: ['square centimeter'] },
      { id: 'mm2', name: '平方毫米', symbol: 'mm²', conv: lin(1e-6), aliases: ['square millimeter'] },
      { id: 'ha', name: '公顷', symbol: 'ha', conv: lin(10000), aliases: ['hectare', '公顷'] },
      { id: 'mu', name: '亩', symbol: '亩', conv: lin(10000 / 15), aliases: ['亩', '市亩'], note: '1 公顷 = 15 亩' },
      { id: 'fen', name: '分', symbol: '分', conv: lin(1000 / 15), aliases: ['分'], note: '1 亩 = 10 分' },
      { id: 'acre', name: '英亩', symbol: 'acre', conv: lin(4046.8564224), aliases: ['acre', 'acres', '英亩'] },
      { id: 'ft2', name: '平方英尺', symbol: 'ft²', conv: lin(0.09290304), aliases: ['square foot', 'sqft'] },
      { id: 'in2', name: '平方英寸', symbol: 'in²', conv: lin(0.00064516), aliases: ['square inch'] },
      { id: 'yd2', name: '平方码', symbol: 'yd²', conv: lin(0.83612736), aliases: ['square yard'] },
      { id: 'mi2', name: '平方英里', symbol: 'mi²', conv: lin(2589988.110336), aliases: ['square mile'] }
    ]
  },
  {
    id: 'volume',
    name: '体积容积',
    defaults: ['l', 'usgal'],
    units: [
      // 基准：立方米 m³
      { id: 'm3', name: '立方米', symbol: 'm³', conv: lin(1), aliases: ['cubic meter', '方', '立方'] },
      { id: 'l', name: '升', symbol: 'L', conv: lin(0.001), aliases: ['liter', 'litre', '公升', '升'] },
      { id: 'ml', name: '毫升', symbol: 'mL', conv: lin(1e-6), aliases: ['milliliter', '毫升', 'cc'] },
      { id: 'cm3', name: '立方厘米', symbol: 'cm³', conv: lin(1e-6), aliases: ['cubic centimeter', 'cc'] },
      { id: 'ft3', name: '立方英尺', symbol: 'ft³', conv: lin(0.028316846592), aliases: ['cubic foot', 'cube feet'] },
      { id: 'in3', name: '立方英寸', symbol: 'in³', conv: lin(0.000016387064), aliases: ['cubic inch'] },
      {
        id: 'usgal',
        name: '加仑(US)',
        symbol: 'gal',
        conv: lin(0.003785411784),
        aliases: ['gallon', 'us gallon', '加仑', '美制加仑'],
        note: '美制：1 gal = 3.785411784 L'
      },
      {
        id: 'ukgal',
        name: '加仑(UK)',
        symbol: 'gal(UK)',
        conv: lin(0.00454609),
        aliases: ['imperial gallon', '英制加仑'],
        note: '英制：1 gal = 4.54609 L，比美制大约 20%'
      },
      { id: 'usqt', name: '夸脱(US)', symbol: 'qt', conv: lin(0.000946352946), aliases: ['quart', '夸脱'] },
      { id: 'uspt', name: '品脱(US)', symbol: 'pt', conv: lin(0.000473176473), aliases: ['pint', '品脱'] },
      {
        id: 'usfloz',
        name: '液量盎司(US)',
        symbol: 'fl oz',
        conv: lin(0.0000295735295625),
        aliases: ['fluid ounce', 'floz', '液量盎司'],
        note: '注意与质量单位「盎司」区分'
      },
      { id: 'ukfloz', name: '液量盎司(UK)', symbol: 'fl oz(UK)', conv: lin(0.0000284130625), aliases: ['imperial fluid ounce'] },
      { id: 'bbl', name: '石油桶', symbol: 'bbl', conv: lin(0.158987294928), aliases: ['barrel', '桶'], note: '1 桶 = 42 US gal' }
    ]
  },
  {
    id: 'mass',
    name: '质量',
    defaults: ['kg', 'lb'],
    units: [
      // 基准：千克 kg
      { id: 'kg', name: '千克', symbol: 'kg', conv: lin(1), aliases: ['kilogram', '公斤', '千克'] },
      { id: 'g', name: '克', symbol: 'g', conv: lin(0.001), aliases: ['gram', '克'] },
      { id: 'mg', name: '毫克', symbol: 'mg', conv: lin(1e-6), aliases: ['milligram'] },
      { id: 'ug', name: '微克', symbol: 'µg', conv: lin(1e-9), aliases: ['microgram'] },
      { id: 't', name: '吨', symbol: 't', conv: lin(1000), aliases: ['tonne', '公吨', '吨'] },
      { id: 'jin', name: '市斤', symbol: '斤', conv: lin(0.5), aliases: ['斤', '市斤'], note: '1 斤 = 500 g' },
      { id: 'liang', name: '两', symbol: '两', conv: lin(0.05), aliases: ['两'], note: '1 斤 = 10 两' },
      { id: 'qian', name: '钱', symbol: '钱', conv: lin(0.005), aliases: ['钱'], note: '1 两 = 10 钱' },
      { id: 'dan', name: '担', symbol: '担', conv: lin(50), aliases: ['担'], note: '1 担 = 100 斤' },
      { id: 'lb', name: '磅', symbol: 'lb', conv: lin(0.45359237), aliases: ['pound', 'pounds', 'lbs', '磅'] },
      { id: 'oz', name: '盎司(常衡)', symbol: 'oz', conv: lin(0.028349523125), aliases: ['ounce', 'ounces', '盎司'], note: '1 lb = 16 oz' },
      {
        id: 'ozt',
        name: '盎司(金衡)',
        symbol: 'ozt',
        conv: lin(0.0311034768),
        aliases: ['troy ounce', '金衡盎司'],
        note: '贵金属用，比常衡盎司重约 10%'
      },
      { id: 'gr', name: '格令', symbol: 'gr', conv: lin(0.00006479891), aliases: ['grain', '格令'] },
      { id: 'ct', name: '克拉', symbol: 'ct', conv: lin(0.0002), aliases: ['carat', '克拉'], note: '1 ct = 200 mg，宝石用' },
      { id: 'st', name: '英石', symbol: 'st', conv: lin(6.35029318), aliases: ['stone'], note: '1 st = 14 lb' },
      { id: 'longton', name: '长吨(英)', symbol: 'long ton', conv: lin(1016.0469088), aliases: ['long ton', '英吨'], note: '1 长吨 = 2240 lb' },
      { id: 'shortton', name: '短吨(美)', symbol: 'short ton', conv: lin(907.18474), aliases: ['short ton', '美吨'], note: '1 短吨 = 2000 lb' }
    ]
  },
  {
    id: 'temperature',
    name: '温度',
    defaults: ['c', 'f'],
    units: [
      // 基准：摄氏度 °C（仿射关系，不能用倍率）
      { id: 'c', name: '摄氏度', symbol: '°C', conv: aff(1, 0), aliases: ['celsius', '摄氏', '度'] },
      { id: 'f', name: '华氏度', symbol: '°F', conv: aff(5 / 9, -160 / 9), aliases: ['fahrenheit', '华氏'] },
      { id: 'k', name: '开尔文', symbol: 'K', conv: aff(1, -273.15), aliases: ['kelvin', '开氏度', '绝对温度'] },
      { id: 'r', name: '兰氏度', symbol: '°R', conv: aff(5 / 9, -273.15), aliases: ['rankine', '兰金'] }
    ]
  },
  {
    id: 'speed',
    name: '速度',
    defaults: ['kmh', 'mph'],
    units: [
      // 基准：米/秒 m/s
      { id: 'ms', name: '米/秒', symbol: 'm/s', conv: lin(1), aliases: ['mps', '米每秒'] },
      { id: 'kmh', name: '千米/时', symbol: 'km/h', conv: lin(1 / 3.6), aliases: ['kph', 'kmh', '公里每小时', '迈'] },
      { id: 'mph', name: '英里/时', symbol: 'mph', conv: lin(0.44704), aliases: ['mile per hour', '英里每小时'] },
      { id: 'kn', name: '节', symbol: 'kn', conv: lin(1852 / 3600), aliases: ['knot', '节'], note: '1 节 = 1 海里/小时 = 1.852 km/h' },
      { id: 'fts', name: '英尺/秒', symbol: 'ft/s', conv: lin(0.3048), aliases: ['fps', '英尺每秒'] }
    ]
  },
  {
    id: 'angle',
    name: '角度',
    defaults: ['deg', 'rad'],
    units: [
      // 基准：度 °
      { id: 'deg', name: '度', symbol: '°', conv: lin(1), aliases: ['degree', '度'] },
      { id: 'rad', name: '弧度', symbol: 'rad', conv: lin(180 / Math.PI), aliases: ['radian', '弧度'] },
      { id: 'grad', name: '百分度', symbol: 'grad', conv: lin(0.9), aliases: ['gradian', 'gon', '百分度'] },
      { id: 'arcmin', name: '角分', symbol: '′', conv: lin(1 / 60), aliases: ['arcminute', '角分'] },
      { id: 'arcsec', name: '角秒', symbol: '″', conv: lin(1 / 3600), aliases: ['arcsecond', '角秒'] },
      { id: 'turn', name: '转', symbol: 'turn', conv: lin(360), aliases: ['revolution', '圈', '转'] },
      { id: 'milnato', name: '密位(北约)', symbol: 'mil', conv: lin(360 / 6400), aliases: ['mil', '密位'], note: '北约制：6400 密位 = 1 圈' },
      { id: 'milru', name: '密位(华约)', symbol: 'mil(SU)', conv: lin(360 / 6000), aliases: ['mil su'], note: '华约制：6000 密位 = 1 圈' }
    ]
  },
  {
    id: 'pressure',
    name: '压力',
    defaults: ['bar', 'psi'],
    units: [
      // 基准：帕斯卡 Pa
      { id: 'pa', name: '帕斯卡', symbol: 'Pa', conv: lin(1), aliases: ['pascal', '帕'] },
      { id: 'kpa', name: '千帕', symbol: 'kPa', conv: lin(1000), aliases: ['kilopascal'] },
      { id: 'mpa', name: '兆帕', symbol: 'MPa', conv: lin(1e6), aliases: ['megapascal'] },
      { id: 'bar', name: '巴', symbol: 'bar', conv: lin(100000), aliases: ['bar', '巴'] },
      { id: 'mbar', name: '毫巴', symbol: 'mbar', conv: lin(100), aliases: ['millibar', 'hPa', '百帕'] },
      { id: 'atm', name: '标准大气压', symbol: 'atm', conv: lin(101325), aliases: ['atmosphere', '大气压'] },
      { id: 'mmhg', name: '毫米汞柱', symbol: 'mmHg', conv: lin(133.322387415), aliases: ['torr', '毫米汞柱', '血压'] },
      { id: 'mmh2o', name: '毫米水柱', symbol: 'mmH₂O', conv: lin(9.80665), aliases: ['mmh2o', '毫米水柱'] },
      { id: 'psi', name: '磅力/平方英寸', symbol: 'psi', conv: lin(6894.757293168361), aliases: ['psi', '胎压'] },
      { id: 'kgfcm2', name: '千克力/平方厘米', symbol: 'kgf/cm²', conv: lin(98066.5), aliases: ['kgcm2', '工程大气压'] }
    ]
  },
  {
    id: 'energy',
    name: '能量',
    defaults: ['kcal', 'kj'],
    units: [
      // 基准：焦耳 J
      { id: 'j', name: '焦耳', symbol: 'J', conv: lin(1), aliases: ['joule', '焦'] },
      { id: 'kj', name: '千焦', symbol: 'kJ', conv: lin(1000), aliases: ['kilojoule', '千焦'] },
      { id: 'mj', name: '兆焦', symbol: 'MJ', conv: lin(1e6), aliases: ['megajoule'] },
      { id: 'cal', name: '卡', symbol: 'cal', conv: lin(4.184), aliases: ['calorie', '热化学卡'] },
      {
        id: 'kcal',
        name: '千卡',
        symbol: 'kcal',
        conv: lin(4184),
        aliases: ['kilocalorie', '大卡', '卡路里'],
        note: '食品包装上的「卡路里」通常指 kcal'
      },
      { id: 'wh', name: '瓦时', symbol: 'Wh', conv: lin(3600), aliases: ['watt hour', '瓦时'] },
      { id: 'kwh', name: '千瓦时', symbol: 'kWh', conv: lin(3600000), aliases: ['kilowatt hour', '度电', '度'] },
      { id: 'ev', name: '电子伏', symbol: 'eV', conv: lin(1.602176634e-19), aliases: ['electronvolt', '电子伏特'] },
      { id: 'btu', name: '英热单位', symbol: 'BTU', conv: lin(1055.05585262), aliases: ['british thermal unit'], note: 'IT 制' },
      { id: 'ftlb', name: '英尺磅力', symbol: 'ft·lb', conv: lin(1.3558179483314004), aliases: ['foot pound'] },
      { id: 'erg', name: '尔格', symbol: 'erg', conv: lin(1e-7), aliases: ['erg', '尔格'] },
      { id: 'tnt', name: '吨 TNT 当量', symbol: 'tTNT', conv: lin(4.184e9), aliases: ['tnt', 'tnt当量'] }
    ]
  },
  {
    id: 'power',
    name: '功率',
    defaults: ['kw', 'hp'],
    units: [
      // 基准：瓦特 W
      { id: 'w', name: '瓦特', symbol: 'W', conv: lin(1), aliases: ['watt', '瓦'] },
      { id: 'kw', name: '千瓦', symbol: 'kW', conv: lin(1000), aliases: ['kilowatt', '千瓦'] },
      { id: 'mw', name: '兆瓦', symbol: 'MW', conv: lin(1e6), aliases: ['megawatt'] },
      {
        id: 'hp',
        name: '马力(机械)',
        symbol: 'hp',
        conv: lin(745.6998715822702),
        aliases: ['horsepower', '马力', '英制马力'],
        note: '机械/英制马力 = 550 ft·lbf/s'
      },
      { id: 'ps', name: '马力(公制)', symbol: 'PS', conv: lin(735.49875), aliases: ['metric horsepower', '匹'], note: '公制马力 = 75 kgf·m/s' },
      { id: 'hpe', name: '马力(电气)', symbol: 'hp(E)', conv: lin(746), aliases: ['electrical horsepower'], note: '电气马力，恰好 746 W' },
      { id: 'rt', name: '冷吨', symbol: 'RT', conv: lin(3516.8528420666667), aliases: ['refrigeration ton', '冷吨'], note: '制冷量 = 12000 BTU/h' },
      { id: 'btuh', name: '英热单位/时', symbol: 'BTU/h', conv: lin(0.2930710701722222), aliases: ['btu per hour'] }
    ]
  },
  {
    id: 'force',
    name: '力',
    defaults: ['n', 'kgf'],
    units: [
      // 基准：牛顿 N
      { id: 'n', name: '牛顿', symbol: 'N', conv: lin(1), aliases: ['newton', '牛'] },
      { id: 'kn', name: '千牛', symbol: 'kN', conv: lin(1000), aliases: ['kilonewton'] },
      { id: 'dyn', name: '达因', symbol: 'dyn', conv: lin(1e-5), aliases: ['dyne', '达因'] },
      { id: 'kgf', name: '千克力', symbol: 'kgf', conv: lin(9.80665), aliases: ['kilogram-force', '公斤力'] },
      { id: 'gf', name: '克力', symbol: 'gf', conv: lin(0.00980665), aliases: ['gram-force', '克力'] },
      { id: 'lbf', name: '磅力', symbol: 'lbf', conv: lin(4.4482216152605), aliases: ['pound-force', '磅力'] }
    ]
  },
  {
    id: 'torque',
    name: '力矩',
    defaults: ['nm', 'kgfm'],
    units: [
      // 基准：牛顿·米 N·m
      { id: 'nm', name: '牛顿·米', symbol: 'N·m', conv: lin(1), aliases: ['newton meter', '扭矩'] },
      { id: 'kgfm', name: '千克力·米', symbol: 'kgf·m', conv: lin(9.80665), aliases: ['kgm', '公斤力米'] },
      { id: 'kgfcm', name: '千克力·厘米', symbol: 'kgf·cm', conv: lin(0.0980665), aliases: ['kgcm'] },
      { id: 'lbfft', name: '磅力·英尺', symbol: 'lbf·ft', conv: lin(1.3558179483314004), aliases: ['foot pound torque', 'lbft'] },
      { id: 'lbfin', name: '磅力·英寸', symbol: 'lbf·in', conv: lin(0.1129848290276167), aliases: ['lbin'] }
    ]
  },
  {
    id: 'density',
    name: '密度',
    defaults: ['kgm3', 'gcm3'],
    units: [
      // 基准：千克/立方米 kg/m³
      { id: 'kgm3', name: '千克/立方米', symbol: 'kg/m³', conv: lin(1), aliases: ['kg/m3'] },
      { id: 'gcm3', name: '克/立方厘米', symbol: 'g/cm³', conv: lin(1000), aliases: ['g/cm3', '克每立方厘米'] },
      { id: 'gl', name: '克/升', symbol: 'g/L', conv: lin(1), aliases: ['g/l'] },
      { id: 'kgl', name: '千克/升', symbol: 'kg/L', conv: lin(1000), aliases: ['kg/l'] },
      { id: 'lbft3', name: '磅/立方英尺', symbol: 'lb/ft³', conv: lin(16.018463373960138), aliases: ['lb/ft3', 'pcf'] },
      { id: 'lbgal', name: '磅/加仑(US)', symbol: 'lb/gal', conv: lin(119.82642731689663), aliases: ['ppg'] }
    ]
  },
  {
    id: 'flow',
    name: '流量',
    defaults: ['m3h', 'lmin'],
    units: [
      // 基准：立方米/小时 m³/h
      { id: 'm3h', name: '立方米/时', symbol: 'm³/h', conv: lin(1), aliases: ['m3/h', '风量'] },
      { id: 'm3s', name: '立方米/秒', symbol: 'm³/s', conv: lin(3600), aliases: ['m3/s', '秒流量'] },
      { id: 'lmin', name: '升/分', symbol: 'L/min', conv: lin(0.06), aliases: ['lpm', 'L/min'] },
      { id: 'ls', name: '升/秒', symbol: 'L/s', conv: lin(3.6), aliases: ['lps', 'L/s'] },
      { id: 'cfm', name: '立方英尺/分', symbol: 'CFM', conv: lin(1.69901079552), aliases: ['cfm'] },
      { id: 'gpm', name: '加仑(US)/分', symbol: 'GPM', conv: lin(0.22712470704), aliases: ['gpm'] }
    ]
  },
  {
    id: 'fuel',
    name: '油耗',
    defaults: ['l100', 'mpgus'],
    units: [
      // 基准：升/百公里 L/100km（油耗与 mpg 是倒数关系，绝不是乘法）
      { id: 'l100', name: '升/百公里', symbol: 'L/100km', conv: lin(1), aliases: ['l/100km', '百公里油耗'] },
      { id: 'kml', name: '公里/升', symbol: 'km/L', conv: rec(100), aliases: ['km/l'], note: 'L/100km = 100 ÷ (km/L)' },
      {
        id: 'mpgus',
        name: '英里/加仑(US)',
        symbol: 'mpg(US)',
        conv: rec(235.21458333333334),
        aliases: ['mpg', 'mpg us'],
        note: 'L/100km = 235.214583 ÷ mpg(US)'
      },
      {
        id: 'mpguk',
        name: '英里/加仑(UK)',
        symbol: 'mpg(UK)',
        conv: rec(282.48093633182214),
        aliases: ['mpg uk', 'imperial mpg'],
        note: '英制加仑更大，同一辆车 mpg(UK) 数值更高'
      }
    ]
  },
  {
    id: 'data',
    name: '存储容量',
    defaults: ['gb', 'gib'],
    units: [
      // 基准：字节 B（十进制与二进制两套并存，是硬盘容量困惑的来源）
      { id: 'bit', name: '比特', symbol: 'bit', conv: lin(0.125), aliases: ['b', '位'] },
      { id: 'byte', name: '字节', symbol: 'B', conv: lin(1), aliases: ['byte', 'bytes', '字节'] },
      { id: 'kb', name: '千字节(10³)', symbol: 'KB', conv: lin(1000), aliases: ['kilobyte'], note: 'SI 十进制：1 KB = 1000 B' },
      { id: 'mb', name: '兆字节(10⁶)', symbol: 'MB', conv: lin(1e6), aliases: ['megabyte'], note: 'SI 十进制' },
      { id: 'gb', name: '吉字节(10⁹)', symbol: 'GB', conv: lin(1e9), aliases: ['gigabyte'], note: '硬盘厂商标称容量用这一套' },
      { id: 'tb', name: '太字节(10¹²)', symbol: 'TB', conv: lin(1e12), aliases: ['terabyte'] },
      { id: 'pb', name: '拍字节(10¹⁵)', symbol: 'PB', conv: lin(1e15), aliases: ['petabyte'] },
      { id: 'kib', name: '千字节(2¹⁰)', symbol: 'KiB', conv: lin(1024), aliases: ['kibibyte'], note: 'IEC 二进制：1 KiB = 1024 B' },
      { id: 'mib', name: '兆字节(2²⁰)', symbol: 'MiB', conv: lin(1048576), aliases: ['mebibyte'], note: 'IEC 二进制' },
      { id: 'gib', name: '吉字节(2³⁰)', symbol: 'GiB', conv: lin(1073741824), aliases: ['gibibyte'], note: '操作系统显示容量用这一套：1 TB = 931.32 GiB' },
      { id: 'tib', name: '太字节(2⁴⁰)', symbol: 'TiB', conv: lin(1099511627776), aliases: ['tebibyte'] }
    ]
  },
  {
    id: 'datarate',
    name: '数据速率',
    defaults: ['mbps', 'mbs'],
    units: [
      // 基准：比特/秒 bit/s
      { id: 'bps', name: '比特/秒', symbol: 'bit/s', conv: lin(1), aliases: ['bps'] },
      { id: 'kbps', name: '千比特/秒', symbol: 'kbit/s', conv: lin(1000), aliases: ['kbps'] },
      { id: 'mbps', name: '兆比特/秒', symbol: 'Mbit/s', conv: lin(1e6), aliases: ['mbps', '宽带兆数'], note: '运营商宣传的「百兆宽带」用这一套' },
      { id: 'gbps', name: '吉比特/秒', symbol: 'Gbit/s', conv: lin(1e9), aliases: ['gbps'] },
      { id: 'bs', name: '字节/秒', symbol: 'B/s', conv: lin(8), aliases: ['byte per second'] },
      { id: 'kbs', name: '千字节/秒', symbol: 'KB/s', conv: lin(8000), aliases: ['kbps byte'] },
      { id: 'mbs', name: '兆字节/秒', symbol: 'MB/s', conv: lin(8e6), aliases: ['mbps byte'], note: '下载速度用这一套：100 Mbit/s = 12.5 MB/s' },
      { id: 'gbs', name: '吉字节/秒', symbol: 'GB/s', conv: lin(8e9), aliases: ['gbps byte'] }
    ]
  },
  {
    id: 'time',
    name: '时间',
    defaults: ['day', 'h'],
    units: [
      // 基准：秒 s（月/年长度不固定，统一标注所采用的约定）
      { id: 'ns', name: '纳秒', symbol: 'ns', conv: lin(1e-9), aliases: ['nanosecond'] },
      { id: 'us', name: '微秒', symbol: 'µs', conv: lin(1e-6), aliases: ['microsecond'] },
      { id: 'ms', name: '毫秒', symbol: 'ms', conv: lin(0.001), aliases: ['millisecond'] },
      { id: 's', name: '秒', symbol: 's', conv: lin(1), aliases: ['second', '秒'] },
      { id: 'min', name: '分', symbol: 'min', conv: lin(60), aliases: ['minute', '分钟'] },
      { id: 'h', name: '小时', symbol: 'h', conv: lin(3600), aliases: ['hour', '时'] },
      { id: 'day', name: '天', symbol: 'd', conv: lin(86400), aliases: ['day', '日'] },
      { id: 'week', name: '周', symbol: 'wk', conv: lin(604800), aliases: ['week', '星期'] },
      { id: 'month', name: '月(平均)', symbol: 'mo', conv: lin(2629746), aliases: ['month', '月'], note: '按格里高利年 ÷ 12 = 30.436875 天' },
      { id: 'year', name: '年(格里高利)', symbol: 'yr', conv: lin(31556952), aliases: ['year', '年'], note: '365.2425 天，公历平均年长' },
      { id: 'yearj', name: '年(儒略)', symbol: 'a', conv: lin(31557600), aliases: ['julian year'], note: '365.25 天，天文计算常用' }
    ]
  }
]

/** 按 id 取分类 */
export function findCategory(categoryId: string): UnitCategory | undefined {
  return UNIT_CATEGORIES.find(c => c.id === categoryId)
}

/** 在指定分类内按 id 取单位 */
export function findUnit(categoryId: string, unitId: string) {
  return findCategory(categoryId)?.units.find(u => u.id === unitId)
}

export const DEFAULT_CATEGORY_ID = 'length'
