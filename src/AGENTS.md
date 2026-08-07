# src / Vue 渲染层知识库

## OVERVIEW
前端渲染层：Vue 3（`<script setup>` + TS）负责 UI、工具页、标签页状态。核心模式是「配置驱动的工具注册表 + 动组件渲染」。

## STRUCTURE
```
src/
├── config/tools.ts      # 工具 + 分类注册表（唯一真相源）
├── stores/tabs.ts       # Pinia 标签页状态
├── components/          # 布局组件（Sidebar/TabBar）+ tools/* 工具卡片
├── types/               # Tool/Tab 类型 + electron.d.ts 全局 Window 类型
├── App.vue              # 根：根据 activeTab → toolComponents[component] 动态渲染
├── main.ts              # createApp + Pinia 挂载
└── style.css            # 全局样式
```

## WHERE TO LOOK
| 任务 | 位置 |
|------|------|
| 工具组件在侧边栏注册 | `config/tools.ts` 的 `tools` 数组 |
| 分类分组 | `config/tools.ts` 的 `categories` |
| 新增工具的动态映射 | `App.vue` 的 `toolComponents` Record |
| 标签页增删/激活 | `stores/tabs.ts`（`openTool`/`closeTab`） |
| 类型定义 | `types/index.ts`；Electron API 类型见 `types/electron.d.ts` |

## CONVENTIONS
- **工具注册流程（新工具三件套）**：① `config/tools.ts` 加 `Tool` 条目；② 在 `components/tools/` 建同名 `.vue`（`component` 字段值）；③ `App.vue` 的 `toolComponents` 注册该组件。
- **别名导入**：一律用 `@/xxx`（映射到 `src/`），不用相对 `../`。
- **状态管理**：跨组件状态进 Pinia store（如 `stores/tabs.ts`），组件内用 `ref` + `computed`。
- **状态类型**：成功/错误提示常用 `ref<'success' | 'error' | ''>` + 样式类映射。
- **FilePicker 模式**：工具卡片读取文件/目录，统一走 `window.electronAPI.dialog.openFile/openDirectory`，不要直接碰 Node。

## ANTI-PATTERNS (THIS PROJECT)
- **不要手写 Node 交互**：动态 dialogs/Python 一律经 preload 暴露的 `electronAPI`，勿 `require('electron')`。
- **不要直接改 `store` 内部 ref**：状态变更通过 store 暴露的函数（`openTool`/`closeTab`/`setActiveTab`）。
- **不要重复硬编码工具映射**：`tools`（数据）与 `toolComponents`（组件）各司其职，改其一需同步另一。