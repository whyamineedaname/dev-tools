/** 可回流格式用 CFI；固定版式（PDF 等）用页码 */
export type ReaderLocation =
  | { kind: 'cfi'; cfi: string; fraction?: number }
  | { kind: 'page'; page: number; fraction?: number }

export interface ReaderProgressRecord {
  /** 文件内容 SHA-256 hex */
  fileHash: string
  /** 最近一次打开的路径（仅展示，不以路径作主键） */
  filePath: string
  fileName: string
  location: ReaderLocation
  updatedAt: number
}

export interface ReaderRecentItem extends ReaderProgressRecord {
  /** 上次路径上的文件是否仍可读 */
  exists: boolean
}

/** 相对页面坐标，取值 0–1，缩放后仍准确 */
export interface RelPoint {
  x: number
  y: number
}

export interface InkStroke {
  id: string
  /** 0-based 页码 */
  page: number
  color: string
  /** 相对页宽的线宽（约 0.002–0.02） */
  width: number
  points: RelPoint[]
  createdAt: number
}

export interface PageNote {
  id: string
  page: number
  x: number
  y: number
  text: string
  tags: string[]
  color: string
  createdAt: number
  updatedAt: number
}

export interface ReaderAnnotationDoc {
  fileHash: string
  inks: InkStroke[]
  notes: PageNote[]
  updatedAt: number
}

export type AnnotTool = 'hand' | 'pen' | 'note' | 'eraser'

export const PEN_COLORS = ['#f56c6c', '#e6a23c', '#409eff', '#67c23a', '#909399', '#303133'] as const
export const NOTE_COLORS = ['#fff7e6', '#f0f9eb', '#ecf5ff', '#fef0f0', '#f4f4f5'] as const

export type ReaderIpcResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }
