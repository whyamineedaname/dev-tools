import type { Tool } from '@/types'

import iconBroccoli from '@/assets/icons/broccoli.png'
import iconCaterpillar from '@/assets/icons/八重神子.png'
import iconCupcake from '@/assets/icons/肖宫.png'
import iconDinosaur from '@/assets/icons/芙宁娜.png'
import iconLion from '@/assets/icons/147629742_p0_master1200-compressed.jpg'
import iconSteak from '@/assets/icons/steak.png'
import iconUnicorn from '@/assets/icons/unicorn.png'
import iconApple from '@/assets/icons/apple.png'
import iconBarbara from '@/assets/icons/芭芭拉.png'
import iconXiangling from '@/assets/icons/香菱.png'
import iconIce from '@/assets/icons/冰.png'
import iconGrass from '@/assets/icons/草.png'
import iconThunder from '@/assets/icons/雷.png'
import iconWater from '@/assets/icons/水.png'
import iconWind from '@/assets/icons/风.png'
import iconAnemo from '@/assets/icons/element-01.png'
import iconGeo from '@/assets/icons/element-02.png'
import iconElectro from '@/assets/icons/element-03.png'
import iconDendro from '@/assets/icons/element-04.png'
import iconHydro from '@/assets/icons/element-05.png'
import iconHydro2 from '@/assets/icons/element-06.png'
import iconPyro from '@/assets/icons/element-07.png'
import iconCryo from '@/assets/icons/element-08.png'
import iconMora from '@/assets/icons/摩拉.png'
import iconVisionHydro from '@/assets/icons/菲谢尔.png'
import iconHutao from '@/assets/icons/hutao.png'

export const tools: Tool[] = [
  {
    id: 'json',
    name: 'JSON 格式化',
    icon: iconSteak,
    category: 'text',
    component: 'JsonTool'
  },
  {
    id: 'crypto',
    name: '加解密',
    icon: iconMora,
    category: 'text',
    component: 'CryptoTool'
  },
  {
    id: 'regex',
    name: '正则测试器',
    icon: iconApple,
    category: 'text',
    component: 'RegexTool'
  },
  {
    id: 'timestamp',
    name: '时间戳转换',
    icon: iconDendro,
    category: 'text',
    component: 'TimestampTool'
  },
  {
    id: 'diff',
    name: '文本对比',
    icon: iconHydro2,
    category: 'text',
    component: 'DiffTool'
  },
  {
    id: 'formatConvert',
    name: '配置格式互转',
    icon: iconXiangling,
    category: 'text',
    component: 'FormatConvertTool'
  },
  {
    id: 'cron',
    name: 'Cron 解析',
    icon: iconIce,
    category: 'text',
    component: 'CronTool'
  },
  {
    id: 'clipboardHistory',
    name: '剪贴板历史',
    icon: iconBarbara,
    category: 'text',
    component: 'ClipboardHistoryTool'
  },
  {
    id: 'fileToMd',
    name: '文档转 Markdown',
    icon: iconCupcake,
    category: 'data',
    component: 'FileToMdTool'
  },
  {
    id: 'docToPdf',
    name: '文档转 PDF',
    icon: iconDinosaur,
    category: 'data',
    component: 'DocToPdfTool'
  },
  {
    id: 'docReader',
    name: '文档阅读器',
    icon: iconVisionHydro,
    category: 'data',
    component: 'DocReaderTool'
  },
  {
    id: 'mp4ToWebp',
    name: 'MP4 转 WebP',
    icon: iconCaterpillar,
    category: 'data',
    component: 'Mp4ToWebpTool'
  },
  {
    id: 'mediaTranscode',
    name: '音视频转码',
    icon: iconGrass,
    category: 'data',
    component: 'MediaTranscodeTool'
  },
  {
    id: 'voiceSeparate',
    name: '人声分离',
    icon: iconThunder,
    category: 'data',
    component: 'VoiceSeparateTool'
  },
  {
    id: 'colorPicker',
    name: '取色器',
    icon: iconUnicorn,
    category: 'color',
    component: 'ColorPickerTool'
  },
  {
    id: 'removeBg',
    name: '图片去背景',
    icon: iconBroccoli,
    category: 'color',
    component: 'RemoveBgTool'
  },
  {
    id: 'qrcode',
    name: '二维码',
    icon: iconHydro,
    category: 'color',
    component: 'QrTool'
  },
  {
    id: 'imageResize',
    name: '图片压缩',
    icon: iconCryo,
    category: 'color',
    component: 'ImageResizeTool'
  },
  {
    id: 'exifTool',
    name: 'EXIF 查看',
    icon: iconIce,
    category: 'color',
    component: 'ExifTool'
  },
  {
    id: 'puzzle',
    name: '图片拼图',
    icon: iconWater,
    category: 'color',
    component: 'PuzzleTool'
  },
  {
    id: 'httpClient',
    name: 'HTTP 客户端',
    icon: iconThunder,
    category: 'network',
    component: 'HttpClientTool'
  },
  {
    id: 'portTool',
    name: '端口占用',
    icon: iconWater,
    category: 'network',
    component: 'PortTool'
  },
  {
    id: 'dnsTool',
    name: 'DNS 查询',
    icon: iconWind,
    category: 'network',
    component: 'DnsTool'
  },
  {
    id: 'biliDownloader',
    name: '视频下载器',
    icon: iconThunder,
    category: 'network',
    component: 'BiliDownloaderTool'
  },
  {
    id: 'theme',
    name: '主题管理',
    icon: iconApple,
    category: 'app',
    component: 'ThemeTool'
  },
  {
    id: 'menu',
    name: '菜单管理',
    icon: iconHutao,
    category: 'app',
    component: 'MenuTool'
  }
]

/** 侧边栏分类：元素符号，与工具图标区分 */
export const categories = [
  { id: 'text', name: '文本处理', icon: iconAnemo },
  { id: 'color', name: '颜色图片', icon: iconPyro },
  { id: 'network', name: '网络调试', icon: iconElectro },
  { id: 'data', name: '数据文件', icon: iconGeo },
  { id: 'app', name: '应用管理', icon: iconHutao }
]

/** 侧边栏标题 Logo */
export const logoIcon = iconLion
