# 文档阅读器 实施方案

> **面向智能体执行者**：步骤需使用复选框（`- [ ]`）语法追踪进度。

**目标**：在「数据文件」分类下新增「文档阅读器」工具，支持 PDF / EPUB / MOBI / AZW3 打开阅读，并按文件内容哈希记忆上次阅读位置；后续迭代补齐选文高亮、笔记标签、PDF 画笔。

**架构思路**：渲染内核 vendor 引入 MIT 许可的 `foliate-js`（内部用 PDF.js 处理 PDF），Electron 主进程负责读二进制与读写阅读记忆；Vue 工具页挂载 `foliate-view` Web Component。**禁止**整包嵌入 Readest（AGPL）等成品应用。MVP 只做「打开 + 定位记忆」，注解与画笔分阶段交付。

**技术栈**：Electron 28 + Vue 3 + TypeScript + Pinia；`vendor/foliate-js`（git submodule 或 vendored copy，MIT）；`pdfjs-dist`（Apache-2.0，供 foliate PDF 适配）；本地 JSON 持久化于 `userData/reader/`。

**验证方式**：本仓库无自动化测试基建（见根 `AGENTS.md`），每阶段用 `npx vue-tsc --noEmit` + `npm run dev` 手动验收，不写 pytest/vitest。

**分期**：
| 阶段 | 内容 | 本方案 |
|------|------|--------|
| MVP | 打开多格式 + 阅读位置记忆 | ✅ 已实现（2026-08-05） |
| P1 | 选文高亮 / 笔记 / 标签 | 附录 A（后续计划） |
| P2 | PDF 自由画笔 | 附录 B（后续计划） |

---

## 文件结构设计

```
dev-tools/
├── vendor/
│   └── foliate-js/              # 新建：vendored 渲染库（勿改许可证头）
├── electron/
│   ├── main.ts                  # 修改：file:readBinary、reader:* IPC
│   └── preload.ts               # 修改：暴露 reader / file.readBinary
├── src/
│   ├── types/
│   │   ├── electron.d.ts        # 修改：与 preload 同步
│   │   └── reader.ts            # 新建：进度/注解类型
│   ├── config/tools.ts          # 修改：注册工具
│   ├── App.vue                  # 修改：注册组件
│   ├── utils/
│   │   └── fileHash.ts          # 新建：SHA-256（Web Crypto）
│   ├── composables/
│   │   └── useReaderProgress.ts # 新建：debounce 存取进度
│   └── components/tools/
│       ├── DocReaderTool.vue    # 新建：工具壳（选文件、状态栏）
│       └── reader/
│           ├── FoliateHost.vue  # 新建：挂载 foliate-view
│           └── reader.css       # 新建：阅读区样式
└── docs/superpowers/plans/
    └── 2026-08-05-document-reader.md
```

**职责边界**：
- `DocReaderTool.vue`：选文件、错误提示、工具栏；不碰 foliate 内部细节。
- `FoliateHost.vue`：创建/销毁 `foliate-view`，`open` / `goTo`，转发 `relocate`。
- `useReaderProgress.ts`：hash → IPC 读写；debounce 800ms。
- 主进程 `reader:*`：仅读写 `userData/reader/progress/<hash>.json`，不做渲染。

---

## 模块 1: IPC 与类型（二进制读取 + 进度存储）

### 任务 1：进度/位置类型定义

**涉及文件**：
- 新建：`src/types/reader.ts`

- [ ] **步骤 1：新建类型文件**

```ts
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

export type ReaderIpcResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }
```

- [ ] **步骤 2：确认无类型循环依赖**（`reader.ts` 不 import Vue / electron）

---

### 任务 2：主进程 IPC — 读二进制 + 进度 CRUD

**涉及文件**：
- 修改：`electron/main.ts`（IPC 区块，约 `file:readText` 附近）
- 参考：现有 `file:readText` / `file:writeBase64` 错误返回形状

- [ ] **步骤 1：增加目录辅助与 IPC**

在 `electron/main.ts` 顶部确认已有 `import { readFile, writeFile, mkdir } from 'fs/promises'` 与 `import { join, dirname } from 'path'`（若缺则补齐）。追加：

```ts
import { createHash } from 'crypto'

function getReaderProgressDir(): string {
  return join(app.getPath('userData'), 'reader', 'progress')
}

async function ensureReaderDirs(): Promise<void> {
  await mkdir(getReaderProgressDir(), { recursive: true })
}

function progressPath(fileHash: string): string {
  // 仅允许 hex，防路径穿越
  if (!/^[a-f0-9]{64}$/i.test(fileHash)) {
    throw new Error('invalid fileHash')
  }
  return join(getReaderProgressDir(), `${fileHash.toLowerCase()}.json`)
}

ipcMain.handle('file:readBinary', async (_event, filePath: string): Promise<{
  success: boolean
  base64?: string
  size?: number
  error?: string
}> => {
  try {
    const buf = await readFile(filePath)
    return { success: true, base64: buf.toString('base64'), size: buf.length }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
})

ipcMain.handle('reader:getProgress', async (_event, fileHash: string) => {
  try {
    await ensureReaderDirs()
    const raw = await readFile(progressPath(fileHash), 'utf-8')
    return { success: true as const, data: JSON.parse(raw) }
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') {
      return { success: true as const, data: null }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})

ipcMain.handle('reader:saveProgress', async (_event, record: unknown) => {
  try {
    const r = record as {
      fileHash: string
      filePath: string
      fileName: string
      location: unknown
      updatedAt: number
    }
    if (!r?.fileHash || !r.location) {
      return { success: false as const, error: 'invalid record' }
    }
    await ensureReaderDirs()
    await writeFile(progressPath(r.fileHash), JSON.stringify(r, null, 2), 'utf-8')
    return { success: true as const, data: undefined }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})
```

- [ ] **步骤 2：本地冒烟（可选）**：`npm run build:electron` 确认编译无报错。

---

### 任务 3：preload + d.ts 同步

**涉及文件**：
- 修改：`electron/preload.ts`
- 修改：`src/types/electron.d.ts`
- **约定**：两端字段必须逐字段一致（见根 `AGENTS.md`）

- [ ] **步骤 1：preload 增加**

在 `file` 下增加 `readBinary`；根级增加 `reader`：

```ts
file: {
  readText: (filePath: string) =>
    ipcRenderer.invoke('file:readText', filePath),
  writeBase64: (filePath: string, base64: string) =>
    ipcRenderer.invoke('file:writeBase64', filePath, base64),
  readBinary: (filePath: string) =>
    ipcRenderer.invoke('file:readBinary', filePath)
},
reader: {
  getProgress: (fileHash: string) =>
    ipcRenderer.invoke('reader:getProgress', fileHash),
  saveProgress: (record: {
    fileHash: string
    filePath: string
    fileName: string
    location: { kind: 'cfi'; cfi: string; fraction?: number } | { kind: 'page'; page: number; fraction?: number }
    updatedAt: number
  }) => ipcRenderer.invoke('reader:saveProgress', record)
}
```

- [ ] **步骤 2：`electron.d.ts` 同步同一结构**（含 `ReaderProgressRecord` 可直接内联或从类型复用——全局 d.ts 里内联以免 declare 依赖路径问题）

- [ ] **步骤 3：`npx vue-tsc --noEmit`**  
  预期：无 `electronAPI` 相关报错。

---

## 模块 2: Vendor foliate-js + Vite 配置

### 任务 4：引入 foliate-js 与 pdfjs-dist

**涉及文件**：
- 新建目录：`vendor/foliate-js/`（完整 clone 或 sparse 拷贝 MIT 源码）
- 修改：`package.json`（加 `pdfjs-dist` 依赖）
- 修改：`vite.config.ts`（必要时 alias / optimizeDeps）
- 可选：根 `.gitignore` **不要** ignore `vendor/foliate-js`（需随仓库提交，或改用 submodule 并在 README 说明）

- [ ] **步骤 1：安装 pdfjs-dist**

```bash
npm install pdfjs-dist@4
```

- [ ] **步骤 2：vendor foliate-js**

```bash
git clone --depth 1 https://github.com/johnfactotum/foliate-js.git vendor/foliate-js
# 若不希望嵌套 .git：
Remove-Item -Recurse -Force vendor/foliate-js/.git
```

保留其 `LICENSE`。确认存在 `view.js`、`mobi.js`、`pdf.js`（适配层）等文件。

- [ ] **步骤 3：Vite 别名（可选但推荐）**

在 `vite.config.ts` 的 `resolve.alias` 增加：

```ts
'foliate-js': resolve(__dirname, 'vendor/foliate-js')
```

`optimizeDeps.exclude` 增加 `'foliate-js'`（原生 ESM、无 package.json 入口时避免预构建踩坑）。

- [ ] **步骤 4：确认 PDF worker**

渲染 PDF 时 foliate 的 PDF 适配需要 PDF.js worker。在 `FoliateHost` 中按 pdfjs-dist 文档设置：

```ts
import * as pdfjs from 'pdfjs-dist'
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()
```

若 Electron 打包后 worker 404，改为把 worker 拷到 `public/pdf.worker.min.mjs` 并用相对路径（`./pdf.worker.min.mjs`）。此问题在任务 7 验收时处理。

---

## 模块 3: 哈希与进度 Composable

### 任务 5：fileHash + useReaderProgress

**涉及文件**：
- 新建：`src/utils/fileHash.ts`
- 新建：`src/composables/useReaderProgress.ts`

- [ ] **步骤 1：`fileHash.ts`**

```ts
/** 对 ArrayBuffer 计算 SHA-256 hex（小写） */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
```

- [ ] **步骤 2：`useReaderProgress.ts`**

```ts
import { ref } from 'vue'
import type { ReaderLocation, ReaderProgressRecord } from '@/types/reader'

export function useReaderProgress() {
  const saving = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest: ReaderProgressRecord | null = null

  async function load(fileHash: string): Promise<ReaderProgressRecord | null> {
    const res = await window.electronAPI.reader.getProgress(fileHash)
    if (!res.success) throw new Error(res.error)
    return res.data
  }

  function scheduleSave(record: ReaderProgressRecord): void {
    latest = record
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, 800)
  }

  async function flush(): Promise<void> {
    if (!latest) return
    saving.value = true
    try {
      const res = await window.electronAPI.reader.saveProgress(latest)
      if (!res.success) console.error('[reader] saveProgress', res.error)
    } finally {
      saving.value = false
    }
  }

  function dispose(): void {
    if (timer) clearTimeout(timer)
    void flush()
  }

  return { saving, load, scheduleSave, flush, dispose }
}

export function locationFromRelocate(detail: {
  cfi?: string
  index?: number
  fraction?: number
}): ReaderLocation {
  if (detail.cfi) {
    return { kind: 'cfi', cfi: detail.cfi, fraction: detail.fraction }
  }
  return {
    kind: 'page',
    page: typeof detail.index === 'number' ? detail.index : 0,
    fraction: detail.fraction
  }
}
```

---

## 模块 4: UI — FoliateHost + DocReaderTool + 注册

### 任务 6：FoliateHost.vue

**涉及文件**：
- 新建：`src/components/tools/reader/FoliateHost.vue`
- 新建：`src/components/tools/reader/reader.css`

- [ ] **步骤 1：实现 FoliateHost**

要点（完整实现时按此契约）：
1. `onMounted` 动态 `import('foliate-js/view.js')`（或 `@/../vendor/foliate-js/view.js`）。
2. `document.createElement('foliate-view')`，append 到 `ref` 容器。
3. props：`fileBlob: Blob`、`fileName: string`、`initialLocation: ReaderLocation | null`。
4. `await view.open(fileBlob)` 后：
   - 若 `initialLocation.kind === 'cfi'` → `await view.goTo(initialLocation.cfi)`
   - 若 `kind === 'page'` → `await view.goTo(initialLocation.page)`（以 foliate 实际 API 为准；若 PDF 用 `select`/`goToFraction`，在联调时按 relocate 字段调整）。
5. 监听 `relocate`，`emit('relocate', e.detail)`。
6. `onBeforeUnmount`：移除 listener、从 DOM 卸下 view。

```vue
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import type { ReaderLocation } from '@/types/reader'
import './reader.css'

const props = defineProps<{
  fileBlob: Blob | null
  initialLocation: ReaderLocation | null
}>()

const emit = defineEmits<{
  relocate: [detail: { cfi?: string; index?: number; fraction?: number }]
  error: [message: string]
  ready: []
}>()

const hostRef = ref<HTMLElement | null>(null)
let view: HTMLElement & {
  open: (book: Blob | File | string) => Promise<unknown>
  goTo: (target: string | number) => Promise<unknown>
  goToFraction?: (f: number) => Promise<unknown>
} | null = null

function onRelocate(e: Event): void {
  const detail = (e as CustomEvent).detail
  emit('relocate', detail)
}

async function ensureView(): Promise<void> {
  if (view || !hostRef.value) return
  await import('../../../../vendor/foliate-js/view.js')
  view = document.createElement('foliate-view') as typeof view
  view!.addEventListener('relocate', onRelocate)
  hostRef.value.append(view!)
}

async function openBlob(blob: Blob, loc: ReaderLocation | null): Promise<void> {
  try {
    await ensureView()
    if (!view) return
    await view.open(blob)
    if (loc?.kind === 'cfi' && loc.cfi) {
      await view.goTo(loc.cfi)
    } else if (loc?.kind === 'page') {
      await view.goTo(loc.page)
    } else if (loc?.fraction != null && view.goToFraction) {
      await view.goToFraction(loc.fraction)
    }
    emit('ready')
  } catch (e: unknown) {
    emit('error', e instanceof Error ? e.message : String(e))
  }
}

watch(
  () => props.fileBlob,
  (blob) => {
    if (blob) void openBlob(blob, props.initialLocation)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  view?.removeEventListener('relocate', onRelocate)
  view?.remove()
  view = null
})
</script>

<template>
  <div ref="hostRef" class="foliate-host" />
</template>
```

- [ ] **步骤 2：`reader.css`** — `.foliate-host { width:100%; height:100%; min-height:480px; }`，确保 `foliate-view` 撑满。

---

### 任务 7：DocReaderTool.vue + 工具注册

**涉及文件**：
- 新建：`src/components/tools/DocReaderTool.vue`
- 修改：`src/config/tools.ts`
- 修改：`src/App.vue`
- 图标：复用已有 `iconCupcake` 或 `iconDinosaur`（勿新增未有资源）

- [ ] **步骤 1：注册 tools.ts**

在 `tools` 数组「数据文件」相关项后追加：

```ts
{
  id: 'docReader',
  name: '文档阅读器',
  icon: iconDinosaur, // 或任选已有图标
  category: 'data',
  component: 'DocReaderTool'
}
```

- [ ] **步骤 2：App.vue**

```ts
import DocReaderTool from '@/components/tools/DocReaderTool.vue'
// toolComponents 增加：
DocReaderTool
```

- [ ] **步骤 3：DocReaderTool.vue 流程**

1. 「选择文件」→ `dialog.openFile`，filters：`pdf, epub, mobi, azw3, azw, fb2, cbz`。
2. `file.readBinary(path)` → `base64ToArrayBuffer` → `sha256Hex`。
3. `progress.load(hash)` 取 `initialLocation`。
4. `new Blob([buffer], { type: mimeFromExt(path) })` 交给 `FoliateHost`。
5. `onRelocate` → `scheduleSave({ fileHash, filePath, fileName, location: locationFromRelocate(detail), updatedAt: Date.now() })`。
6. `onBeforeUnmount` → `dispose()` 强制 flush。
7. UI：标题「📖 文档阅读器」、当前文件名、进度百分比（若有 `fraction`）、错误条（沿用 `resultType` success/error 模式）。

MIME 建议：

```ts
function mimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
    azw3: 'application/vnd.amazon.ebook',
    azw: 'application/vnd.amazon.ebook',
    fb2: 'application/x-fictionbook+xml',
    cbz: 'application/vnd.comicbook+zip'
  }
  return map[ext || ''] || 'application/octet-stream'
}
```

工具页布局：上方工具条固定高度，下方 `FoliateHost` 占满剩余高度；`tool-content` 对阅读器可考虑局部 `overflow:hidden`（仅本组件根节点 `height:100%; display:flex; flex-direction:column`）。

- [ ] **步骤 4：类型检查**

```bash
npx vue-tsc --noEmit
```

预期：通过。

- [ ] **步骤 5：手动验收清单**

```bash
npm run dev
```

| # | 操作 | 预期 |
|---|------|------|
| 1 | 侧边栏「数据文件」出现「文档阅读器」 | 可打开标签页 |
| 2 | 打开一本 EPUB | 正文可翻页/滚动 |
| 3 | 翻到中后部，关闭标签，再打开同一文件 | 回到接近上次位置 |
| 4 | 复制文件到新路径再打开 | 仍能恢复（哈希主键） |
| 5 | 打开 PDF | 可浏览；位置可按页恢复 |
| 6 | 打开 MOBI 或 AZW3 | 能打开或给出明确错误（不白屏） |
| 7 | DevTools 无 CSP/worker 致命报错 | 若有 worker 404，按任务 4 步骤 4 修复 |

---

## 模块 5: 文档与提交（仅在用户要求 commit 时执行）

### 任务 8：更新 AGENTS 索引（可选短注）

**涉及文件**：
- 修改：根 `AGENTS.md` WHERE TO LOOK 表增加一行「文档阅读器 | `DocReaderTool.vue` + `vendor/foliate-js`」
- 修改：`src/AGENTS.md` 工具注册说明无需大改（流程已覆盖）

- [ ] **步骤 1：补一行 WHERE TO LOOK**（保持简短）

- [ ] **步骤 2：用户明确要求提交时再 git commit**；提交信息建议：

```
feat: add document reader with reading position memory

Integrate foliate-js for PDF/EPUB/MOBI/AZW3 and persist last location by content hash.
```

---

## 风险与对策

| 风险 | 对策 |
|------|------|
| foliate-js API 不稳定 | pin 到具体 commit；升级时回归验收表 |
| AGPL 污染 | 禁止复制 Readest 源码；只参考公开文档与 MIT 的 foliate-js |
| PDF.js worker 打包路径 | 优先 `import.meta.url`；失败则放 `public/` |
| 大文件 base64 IPC 内存翻倍 | MVP 可接受；后续可改 `file://` 自定义协议或 `Uint8Array` 分块 |
| EPUB 内嵌脚本 XSS | Electron 已有 contextIsolation；后续可加 CSP；勿对不可信书启用脚本 |
| `tool-content` padding 挤压阅读区 | DocReaderTool 用负边距或全高 flex 抵消 |

---

## 附录 A：P1 选文高亮 / 笔记 / 标签（后续方案提纲）

不在本 MVP 实施。提纲：
- 存储：`userData/reader/annotations/<hash>.json`
- 模型：`{ id, cfiRange \| pageRects, color, note, tags[], createdAt }`
- UI：选区弹出「高亮 / 笔记」；右侧注解列表点击 `goTo`
- 渲染：foliate `overlayer.js` 绘制 highlight

## 附录 B：P2 PDF 画笔（后续方案提纲）

- 每页 canvas 叠加，笔画存相对坐标 `[{x,y}...]`（0–1）
- 参考 Theorem（MIT）交互，**不要**抄 AGPL 代码
- IPC：`reader:saveInk` / 与 annotations 同文件分 `inks` 字段

---

## 执行交接

方案已完成并保存至 `docs/superpowers/plans/2026-08-05-document-reader.md`。

**建议执行顺序**：任务 1 → 2 → 3 → 4 → 5 → 6 → 7 →（可选 8）。

是否开始执行 MVP？确认后按任务顺序改代码，每完成一个模块跑一次 `vue-tsc`。
