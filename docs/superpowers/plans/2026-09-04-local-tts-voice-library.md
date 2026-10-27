# 本地私人音色库 + TTS 实施方案

> **面向智能体执行者**：步骤需使用复选框（`- [ ]`）语法追踪进度。

**目标**：在「数据文件」下新增「语音合成」：本地私人音色库 + CosyVoice 常驻 worker 导出 wav/mp3。

**架构思路**：渲染进程只走 `electronAPI.tts`；主进程管 `userData/tts-voices`、FFmpeg、worker 生命周期；`python-scripts/tts_worker.py` 用 NDJSON 做 probe/download/load/synth。模型不进安装包。仓库无自动化测试，用 `npx vue-tsc --noEmit` 验收。

**技术栈**：Electron 28、Vue 3、Python 3.10/3.11、CosyVoice（Apache 2.0，用户自装）、FFmpeg。

**规格**：`docs/superpowers/specs/2026-09-03-local-tts-voice-library-design.md`

---

## 文件结构

- 新建 `electron/tts.ts` — 库、worker、IPC、will-quit
- 新建 `python-scripts/tts_worker.py`
- 新建 `src/types/tts.ts`、`src/components/tools/TtsTool.vue`
- 修改 `electron/main.ts`、`electron/preload.ts`、`src/types/electron.d.ts`
- 修改 `src/config/tools.ts`、`src/App.vue`、`src/components/Sidebar.vue`、`README.md`

模型目录：`Fun-CosyVoice3-0.5B/` 含 `llm.pt` 视为就绪；300M 同理。下载 ModelScope `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` 与 `iic/CosyVoice-300M`，失败再 HuggingFace。

IPC 合成入参：`outputDir` + `fileName` + `format`，主进程拼接并校验 basename。`tts:probe` 返回 `lastOutputDir` 与 `desktopDir`。

---

## 模块 1: worker 与主进程

- [x] 实现 `tts_worker.py` 与 `electron/tts.ts`，在 `main.ts` 调用 `registerTtsIpc()`
- [x] `npx vue-tsc --noEmit`（仅既有 PuzzleTool 报错，与本次无关）

## 模块 2: 界面与文档

- [x] `TtsTool.vue` 注册、README 环境说明
