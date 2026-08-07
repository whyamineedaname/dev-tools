# dev-tools 知识库

**生成时间：2026-08-04**
**类型：重构中的 Electron 桌面应用（Windows）**

## OVERVIEW
「兔丝」Windows 桌面工具集。技术栈：Electron 28 + Vue 3（`<script setup>` Composition API）+ Pinia + Vite 5 + TypeScript（strict）+ CodeMirror 6。工具执行重活委托给 Python 子进程（转换文档）。

## STRUCTURE
```
dev-tools/
├── electron/         # 主进程：窗口管理、IPC、Python 子进程桥
├── src/              # Vue 渲染层（前端，见 src/AGENTS.md）
├── python-scripts/   # Python 转换脚本，开发+打包双路径加载
├── index.html        # Vite 入口，挂载 #app
├── package.json      # 应用+构建配置
└── vite.config.ts    # 端口 33445，别名 @→src
```

## WHERE TO LOOK
| 任务 | 位置 | 备注 |
|------|------|------|
| 新增一个工具 | `src/config/tools.ts` 注册 + `src/components/tools/*.vue` | 见 src/AGENTS.md 完整流程 |
| IPC 通道 / 文件对话框 | `electron/main.ts`（handle）+ `electron/preload.ts`（暴露） | 两端需同步加 |
| 前端调用 Python | `window.electronAPI.python.*` | 返回 `{success, output, error}` |
| Python 转换逻辑 | `python-scripts/filetomd.py`、`doctopdf_single.py` | markitdown / pptx+reportlab |
| 用户界面类型声明 | `src/types/electron.d.ts` | preload 类型必须同步 |

## CONVENTIONS
- **IPC 命名**：`area:action` 冒号式（如 `dialog:openFile`、`python:fileToMd`）。
- **preload 与 d.ts 同步**：`electron/preload.ts` 暴露的 `electronAPI` 结构与 `src/types/electron.d.ts` 的 `Window.electronAPI` 全局类型必须逐字段一致。
- **IPC 返回形状**：Python 调用统一返回 `{ success: boolean; output: string; error: string }`。
- **路径分隔符**：前端拼接 Windows 路径用 `\\`（见 `FileToMdTool.vue` 的 `outputPath`）。
- **脚本目录双路径**：开发态 `process.cwd()/python-scripts`，打包态 `process.resourcesPath/python-scripts`，由 `getScriptsDir()` 切换。
- **安全基线**：`contextIsolation: true`、`nodeIntegration: false`，渲染层只能经 preload 桥访问 Node。

## ANTI-PATTERNS (THIS PROJECT)
- **不要在渲染层 `require('electron')`**。示例：`FileToMdTool.vue` 的 `openOutputDir` 用 `require('electron').shell` 是本项目唯一的违规点，属已知病态，勿复制此模式——统一走 preload 桥。
- **不要破坏 preload 与 d.ts 的类型一致性**（否则运行时 `electronAPI` undefined，编译期报错）。
- **不要改 `vite.config.ts` 的端口/别名校验**：`strictPort: 33445` 是 dev 脚本 `wait-on tcp:33445` 的契约。
- **不要用 `@ts-ignore` / `as any` 掩盖类型错误**（`strict: true`）。

## UNIQUE STYLES
- UI 主题色复用 Element 风格色板（主色 `#409eff`、成功 `#67c23a`、危险 `#f56c6c`）。
- 工具组件模板含 emoji 图标（`📄`/`📑`）与中文描述文案。
- **存在已知遗留问题**：`FileToMdTool.vue` 的 `openOutputDir` 里 `shell` 非 preload 提供，功能未真正接线（占位调用）。

## COMMANDS
```bash
npm run dev            # vite + esbuild(主进程watch) + electron 并行
npm run build          # vue-tsc 类型检查 + vite build + esbuild + electron-builder
npm run dev:electron   # 仅编译主进程（watch）
npm run build:electron # 仅编译主进程（minify，无 watch）
```
> Python 脚本依赖：`markitdown`、`python-pptx`、`PIL`、`reportlab`、`pywin32`（Windows），非 npm 管理。

## NOTES
- 根目录还有一个中文名 `.bat` 启动脚本（一键启动）。
- 打包时 `python-scripts` 经 `build.extraResources` 复制到应用资源目录。
- 无自动化测试基建（无 test 配置）；验证主要靠 `vue-tsc --noEmit` 类型检查。