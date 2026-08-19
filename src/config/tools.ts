import type { Tool } from '@/types'

// ============================================================
// 工具图标：按「菜单名称」命名（icon + 菜单名），便于调整默认图标
// 同一图片文件若被多个菜单复用，则为每个用途单独声明一个变量，
// 这样只改某个菜单的图标时，不会影响其他菜单。
// 调整默认图标：改对应变量指向的图片文件路径即可。
// ============================================================

// 文本处理分类
import iconJson from '@/assets/icons/steak.png' // 用于：JSON 格式化
import iconCrypto from '@/assets/icons/caterpillar.png' // 用于：加解密
import iconRegex from '@/assets/icons/apple.png' // 用于：正则测试器
import iconTimestamp from '@/assets/icons/broccoli.png' // 用于：时间戳转换
import iconDiff from '@/assets/icons/dinosaur.png' // 用于：文本对比
import iconFormatConvert from '@/assets/icons/cupcake.png' // 用于：配置格式互转
import iconCron from '@/assets/icons/unicorn.png' // 用于：Cron 解析
import iconClipboard from '@/assets/icons/lion.png' // 用于：剪贴板历史

// 数据文件分类
import iconFileToMd from '@/assets/icons/肖宫.png' // 用于：文档转 Markdown
import iconDocToPdf from '@/assets/icons/芙宁娜.png' // 用于：文档转 PDF
import iconDocReader from '@/assets/icons/菲谢尔.png' // 用于：文档阅读器
import iconMp4ToWebp from '@/assets/icons/八重神子.png' // 用于：MP4 转 WebP
import iconMediaTranscode from '@/assets/icons/莹.png' // 用于：音视频转码
import iconVoiceSeparate from '@/assets/icons/芭芭拉.png' // 用于：人声分离
import iconOcr from '@/assets/icons/香菱.png' // 用于：OCR 文字识别

// 颜色图片分类
import iconColorPicker from '@/assets/icons/1魂-compressed.png' // 用于：取色器
import iconRemoveBg from '@/assets/icons/2魂-compressed.png' // 用于：图片去背景
import iconQrcode from '@/assets/icons/3魂-compressed.png' // 用于：二维码
import iconImageResize from '@/assets/icons/4魂-compressed.png' // 用于：图片压缩
import iconExif from '@/assets/icons/5魂-compressed.png' // 用于：EXIF 查看
import iconPuzzle from '@/assets/icons/6魂-compressed.png' // 用于：图片拼图

// 网络调试分类
import iconHttpClient from '@/assets/icons/雷.png' // 用于：HTTP 客户端
import iconPort from '@/assets/icons/水.png' // 用于：端口占用
import iconDns from '@/assets/icons/风.png' // 用于：DNS 查询
import iconBiliDownloader from '@/assets/icons/火.png' // 用于：视频下载器
import iconDataSync from '@/assets/icons/岩.png' // 用于：数据同步

// 应用管理分类
import iconTheme from '@/assets/icons/144839450_p3_master1200-compressed.jpg' // 用于：主题管理
import iconMenu from '@/assets/icons/144839450_p2_master1200-compressed.jpg' // 用于：菜单管理

// 计算工具分类
import iconLoanCalc from '@/assets/icons/摩拉.png' // 用于：房贷计算器

// ============================================================
// 侧边栏分类图标 + 应用 Logo
// ============================================================
import iconCatText from '@/assets/icons/element-07.png' // 用于：分类「文本处理」
import iconCatColor from '@/assets/icons/element-06.png' // 用于：分类「颜色图片」
import iconCatNetwork from '@/assets/icons/element-03.png' // 用于：分类「网络调试」
import iconCatData from '@/assets/icons/element-02.png' // 用于：分类「数据文件」
import iconCatApp from '@/assets/icons/element-08.png' // 用于：分类「应用管理」
import iconCatCalc from '@/assets/icons/element-04.png' // 用于：分类「计算工具」
import iconLogo from '@/assets/icons/147629742_p0_master1200-compressed.jpg' // 用于：应用 Logo（侧边栏标题）

export const tools: Tool[] = [
  {
    id: 'json',
    name: 'JSON 格式化',
    icon: iconJson,
    category: 'text',
    component: 'JsonTool'
  },
  {
    id: 'crypto',
    name: '加解密',
    icon: iconCrypto,
    category: 'text',
    component: 'CryptoTool'
  },
  {
    id: 'regex',
    name: '正则测试器',
    icon: iconRegex,
    category: 'text',
    component: 'RegexTool'
  },
  {
    id: 'timestamp',
    name: '时间戳转换',
    icon: iconTimestamp,
    category: 'text',
    component: 'TimestampTool'
  },
  {
    id: 'diff',
    name: '文本对比',
    icon: iconDiff,
    category: 'text',
    component: 'DiffTool'
  },
  {
    id: 'formatConvert',
    name: '配置格式互转',
    icon: iconFormatConvert,
    category: 'text',
    component: 'FormatConvertTool'
  },
  {
    id: 'cron',
    name: 'Cron 解析',
    icon: iconCron,
    category: 'text',
    component: 'CronTool'
  },
  {
    id: 'clipboardHistory',
    name: '剪贴板历史',
    icon: iconClipboard,
    category: 'text',
    component: 'ClipboardHistoryTool'
  },
  {
    id: 'fileToMd',
    name: '文档转 Markdown',
    icon: iconFileToMd,
    category: 'data',
    component: 'FileToMdTool'
  },
  {
    id: 'docToPdf',
    name: '文档转 PDF',
    icon: iconDocToPdf,
    category: 'data',
    component: 'DocToPdfTool'
  },
  {
    id: 'docReader',
    name: '文档阅读器',
    icon: iconDocReader,
    category: 'data',
    component: 'DocReaderTool'
  },
  {
    id: 'mp4ToWebp',
    name: 'MP4 转 WebP',
    icon: iconMp4ToWebp,
    category: 'data',
    component: 'Mp4ToWebpTool'
  },
  {
    id: 'mediaTranscode',
    name: '音视频转码',
    icon: iconMediaTranscode,
    category: 'data',
    component: 'MediaTranscodeTool'
  },
  {
    id: 'voiceSeparate',
    name: '人声分离',
    icon: iconVoiceSeparate,
    category: 'data',
    component: 'VoiceSeparateTool'
  },
  {
    id: 'ocr',
    name: 'OCR 文字识别',
    icon: iconOcr,
    category: 'data',
    component: 'OcrTool'
  },
  {
    id: 'colorPicker',
    name: '取色器',
    icon: iconColorPicker,
    category: 'color',
    component: 'ColorPickerTool'
  },
  {
    id: 'removeBg',
    name: '图片去背景',
    icon: iconRemoveBg,
    category: 'color',
    component: 'RemoveBgTool'
  },
  {
    id: 'qrcode',
    name: '二维码',
    icon: iconQrcode,
    category: 'color',
    component: 'QrTool'
  },
  {
    id: 'imageResize',
    name: '图片压缩',
    icon: iconImageResize,
    category: 'color',
    component: 'ImageResizeTool'
  },
  {
    id: 'exifTool',
    name: 'EXIF 查看',
    icon: iconExif,
    category: 'color',
    component: 'ExifTool'
  },
  {
    id: 'puzzle',
    name: '图片拼图',
    icon: iconPuzzle,
    category: 'color',
    component: 'PuzzleTool'
  },
  {
    id: 'httpClient',
    name: 'HTTP 客户端',
    icon: iconHttpClient,
    category: 'network',
    component: 'HttpClientTool'
  },
  {
    id: 'portTool',
    name: '端口占用',
    icon: iconPort,
    category: 'network',
    component: 'PortTool'
  },
  {
    id: 'dnsTool',
    name: 'DNS 查询',
    icon: iconDns,
    category: 'network',
    component: 'DnsTool'
  },
  {
    id: 'dataSync',
    name: '数据同步',
    icon: iconDataSync,
    category: 'network',
    component: 'DataSyncTool'
  },
  {
    id: 'biliDownloader',
    name: '视频下载器',
    icon: iconBiliDownloader,
    category: 'network',
    component: 'BiliDownloaderTool'
  },
  {
    id: 'loanCalc',
    name: '房贷计算器',
    icon: iconLoanCalc,
    category: 'calc',
    component: 'LoanCalcTool'
  },
  {
    id: 'theme',
    name: '主题管理',
    icon: iconTheme,
    category: 'app',
    component: 'ThemeTool'
  },
  {
    id: 'menu',
    name: '菜单管理',
    icon: iconMenu,
    category: 'app',
    component: 'MenuTool'
  }
]

/** 侧边栏分类：元素符号，与工具图标区分 */
export const categories = [
  { id: 'text', name: '文本处理', icon: iconCatText },
  { id: 'color', name: '颜色图片', icon: iconCatColor },
  { id: 'network', name: '网络调试', icon: iconCatNetwork },
  { id: 'data', name: '数据文件', icon: iconCatData },
  { id: 'calc', name: '计算工具', icon: iconCatCalc },
  { id: 'app', name: '应用管理', icon: iconCatApp }
]

/** 侧边栏标题 Logo */
export const logoIcon = iconLogo
