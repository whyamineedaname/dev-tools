# 本地私人音色库 + TTS 规格

**日期：** 2026-09-03  
**状态：** 已确认设计，待实施规划  
**应用：** 兔丝（Electron + Vue 3，MIT）

## 1. 背景与目标

在「数据文件」分类下新增工具「语音合成」。用户在本机维护私人音色库（参考音频 + 转写），用选中音色把文本合成 wav / mp3。交互对齐 Fish Audio 的「音色是一等公民」：先入库参考音，再按音色导出文件。页内只试听参考音，不播放合成结果。不做社区广场、不联网拉音色。

成功标准：

- 在 **Apple Silicon M4、24 GB 统一内存** 上，使用 CosyVoice 3 完成：导入一条自己的参考音 → 合成一段中文并导出。
- 应用本体保持 MIT；推理引擎使用 Apache 2.0 的 CosyVoice，权重由用户本机下载，不打进安装包。
- Windows（16 GB 内存 + GTX 1060 级 6 GB 显存）**不作为验收机**。该机若 CUDA 可用则降级 CosyVoice-300M；若 CUDA 不可用则 CPU 合成并警告极慢，**不因机型拒绝合成按钮**。OOM 时失败并给出文案。

## 2. 范围

### 2.1 第一期要做

- 本地音色列表：导入、重命名、删除、试听参考音。
- 每条音色：参考 wav（导入时转成 16 kHz 单声道）+ 用户手填转写。
- 选中音色后输入文本，导出 wav 或 mp3。
- Python 常驻 worker：模型加载一次，JSON 行协议通信。
- 环境探测：Python、依赖、模型目录、设备（`mps` / `cuda` / `cpu`）。
- README 增加与 OCR 同风格的可选环境说明。

### 2.2 第一期不做

- 社区音色广场、角色/名人音色、爬取或对接 Fish Audio / ChatTTS-UI。
- 自动 ASR 填转写、语速/情感滑条、流式边生成边播。
- 将 PyTorch 或模型打进 `electron-builder` 安装包。
- 保证 GTX 1060 跑通 CosyVoice 3。
- Qwen3-TTS、Kokoro；`index.json` 不预留 `engine` 字段。

### 2.3 合规

- 界面须提示：只导入自己拥有或已获授权的录音；克隆他人声音可能违法。
- 不内置任何第三方角色音色样本。

## 3. 架构

```
Vue 工具页  --IPC-->  Electron 主进程  --stdin/stdout NDJSON-->  tts_worker.py
                         |                                         |
                         | userData/tts-voices/                    | 本机模型目录
                         | FFmpeg 转码                             | CosyVoice 推理
```

- **渲染进程：** 只通过 `window.electronAPI.tts.*` 调 IPC，不 spawn Python、不直接读 `userData`。
- **主进程：** 音色库增删改查、FFmpeg、worker 生命周期、把任务写成一行 JSON 发给 worker。
- **Worker：** 探测设备、下载权重、加载模型、按参考音 + 转写 + 文本写出 wav。不写 `index.json`。

不使用现有 `runPythonScript` 做合成（每次加载模型过慢）。OCR 等短脚本保持原样。

互斥范围：`download` / `load` / `synth` 与音色库写入（`import` / `update` / `delete`）共用一把锁，不得并行。`probe`、`tts:list`、`tts:readRef` 只读，可与锁外并发（worker 若正在执行写操作，`probe` 仍须等当前 op 结束，因其占用同一 stdin）。

**抢占：** `tts:stopWorker` 与 `will-quit` **立即** `kill` worker 进程（可先尝试 stdin 写 `shutdown`，但不等待当前 `download`/`synth` 跑完）。被杀掉的 in-flight 请求对渲染进程返回失败「已取消」。不把 `shutdown` 排在 30 分钟下载队列末尾。

## 4. 模块与职责

### 4.1 音色库（主进程）

根目录：`app.getPath('userData')/tts-voices/`。

```
tts-voices/
  index.json
  models/                 # CosyVoice 权重（首次下载）
  items/<id>/
    ref.wav               # 导入后的 16 kHz mono PCM wav
```

不写 `meta.json`。权威数据只有 `index.json`。

`index.json` 形状：

```json
{
  "version": 1,
  "voices": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "我的声音",
      "transcript": "参考音频里说的那句话。",
      "note": "",
      "durationMs": 8200,
      "createdAt": 1730000000000,
      "updatedAt": 1730000000000
    }
  ]
}
```

规则：

- `id` 使用 `crypto.randomUUID()`，创建后不变。
- `name` 非空，最长 64 字，库内显示名可重复。
- `transcript` 必填，最长 500 字；与参考音频内容对应，供 CosyVoice zero-shot。
- `note` 可选，最长 200 字；导入表单提供选填，列表不展示，重命名面板可改。
- `durationMs` 为转换后 `ref.wav` 的时长（毫秒，整数）；列表直接显示，不再每次探测文件。
- 参考音频导入：用户选 wav/mp3/m4a/flac → FFmpeg 转为 `items/<id>/ref.wav`（16 kHz、mono、pcm_s16le）。时长须在 **3～30 秒**。过短、过长、无音频流则失败且不写半条记录。
- 删除：从 `voices` 移除并删除 `items/<id>/` 目录。
- 并发：见第 3 节互斥与抢占。

**冷启动与损坏：**

- `index.json` 不存在：视为 `{ "version": 1, "voices": [] }`，第一次成功导入时再落盘。
- `index.json` 不是合法 JSON、缺少 `voices` 数组、或 `version` 不是 `1`：`tts:list` 失败，文案「音色库文件损坏」，不自动覆盖。用户可关掉工具后手动删该文件；应用不提供一键清空按钮（YAGNI）。
- `voices` 中某条 `id` 对应的 `items/<id>/ref.wav` 缺失：列表仍返回该条，但标记不可用（IPC 增加 `missingFile: true`）；试听与合成拒绝，允许删除以清理条目。
- `items/` 下存在无索引的孤儿目录：忽略，不自动扫入列表。

### 4.2 Worker 进程

脚本：`python-scripts/tts_worker.py`（随 `extraResources` 分发，与 `ocr.py` 相同打包方式）。

启动：`python3`（Windows 为 `python`）+ 脚本路径。环境变量：

- `TTS_MODEL_DIR`：指向 `userData/tts-voices/models`。
- `TTS_DEVICE`：可选 `cpu`，强制 CPU（覆盖自动选择）。未设则按下面表格。
- `PYTHONIOENCODING=utf-8`。
- `PYTHONUNBUFFERED=1`。
- `COSYVOICE_HOME`：可选，worker 启动时插入 `sys.path`。

协议：stdin 每行一个 JSON 请求，stdout 每行一个 JSON 响应。stderr 仅日志，主进程可转发到调试输出，不解析为结果。请求须带 `id`（字符串），响应回传同一 `id`。

下载进度：worker 在 `download` 期间允许向 stdout 输出多行 JSON，其中 `ok` 可省略，带 `progress: true`、`phase: "download"`、`percent`（0–100 整数，未知则省略）、`message`。**最终一行**必须是带同一请求 `id` 且含 `ok` 的完成/失败响应。主进程把 `progress: true` 的行转成 `tts:progress`，不当作 IPC 返回值。

| `op` | 请求字段 | 成功响应 |
|------|----------|----------|
| `probe` | 无 | `device`：`mps` \| `cuda` \| `cpu`；`model`：`cosyvoice3` \| `cosyvoice300m`；`modelReady`：boolean；`cosyvoiceImportOk`：boolean；`message` |
| `download` | 无 | `modelReady: true`；失败 `ok: false` |
| `load` | 无 | `model`、`device` |
| `synth` | `text`、`promptWav`、`promptText`、`outWav` | `outWav` 绝对路径 |
| `shutdown` | 无 | `ok: true` 后进程退出 |

通用响应：`{ "id", "ok": true|false, "error"?: string, ... }`。

`download` 超时：**30 分钟**（超时后主进程 `kill`，等同取消）。离开工具或退出应用走第 3 节抢占 kill。已下完的文件保留；未完成的 `.partial` 下次 `download` 时清理。第一期 UI 不单独做「取消下载」按钮。

`download` 失败：保留已下载的完整文件；删除未完成的 `.partial` 目录。可再次 `download` 重试。不自动重试。

设备与模型选择（自上而下第一条命中；进程生命周期内不变；`TTS_DEVICE=cpu` 时跳过 MPS/CUDA 行，走「其他」）：

| 条件 | 设备 | 模型 |
|------|------|------|
| macOS 且 MPS 可用且未强制 CPU | `mps` | CosyVoice 3（Fun-CosyVoice3-0.5B） |
| CUDA 可用且显存 ≥ 8192 MiB | `cuda` | CosyVoice 3 |
| CUDA 可用且显存 ≥ 4096 MiB 且小于 8192 MiB | `cuda` | CosyVoice-300M |
| 其他 | `cpu` | CosyVoice 3；Windows 上 `message` 警告极慢 |

`probe` 在 `import cosyvoice` 失败时：`ok: true`（进程活着），`cosyvoiceImportOk: false`，`modelReady: false`，`message` 指向 README。此时 `download` / `load` / `synth` 返回 `ok: false` 同一文案。

`load` 在第一次 `synth` 前由主进程调用；已加载则立即成功。权重不存在时 `load` 失败，提示先下载。

`synth`：文本 1～2000 字（Unicode 码点）。`outWav` 由主进程指定为 **系统临时目录** 下的唯一文件名（不写用户桌面）。worker 写出 `*.partial.wav` 后 rename 为该临时路径。失败删除 partial。临时路径每次新建，worker 侧不处理「用户最终文件已存在」。

超时：`synth` **10 分钟**；超时杀 worker。`load` **5 分钟**。`probe` **30 秒**。

崩溃重启：主进程对 worker 维护 `crashCount`。自上次成功 `probe` 或 `synth` 起，若进程**非** `stopWorker`/`will-quit`/`kill` 而退出，则重启并再执行当前请求 **最多 1 次**。若重启后该请求仍失败，或 60 秒内第 2 次非正常退出，则不再重启，IPC 报错「语音引擎已停止，请重新打开本工具」。用户离开工具或退出应用触发的 kill 不计入崩溃、不自动重启。

### 4.3 主进程 IPC

Preload 暴露 `electronAPI.tts`，类型写在 `src/types/electron.d.ts`。

| 通道 | 行为 |
|------|------|
| `tts:probe` | 确保 worker 活着，发 `probe` |
| `tts:downloadModel` | 发 `download`；把进度行转到 `tts:progress` |
| `tts:list` | 读 `index.json`（含冷启动规则） |
| `tts:import` | `name`、`sourcePath`、`transcript`、`note?`。FFmpeg + 写库 |
| `tts:update` | 改 `name` / `transcript` / `note` |
| `tts:delete` | 删条目与目录 |
| `tts:readRef` | 参数 `voiceId`，返回 `{ mime: 'audio/wav', base64: string }`。仅允许读 `items/<id>/ref.wav`。渲染进程解码后建 `Blob` |
| `tts:synthesize` | `voiceId`、`text`、`outputPath`、`format`: `wav` \| `mp3`、`overwrite?`。先检查最终 `outputPath`：已存在且 `overwrite !== true` 则拒绝，不启动 `synth`。通过后 `load` → `synth` 到系统临时 wav → 若 mp3 则 FFmpeg 写到 `outputPath` 并删临时文件；若 wav 则把临时文件移动到 `outputPath`（允许覆盖当 `overwrite === true`）。失败清理临时文件 |
| `tts:stopWorker` | 抢占 kill，见第 3 节 |

进度事件 `tts:progress`：`phase` 为 `download` \| `load` \| `synth` \| `ffmpeg`；`percent?`；`message?`。仅 `download` 由 worker 多行 JSON 上报；`load` / `synth` / `ffmpeg` 由主进程在发出对应步骤时推一条 `message`（无 percent）。Preload 提供 `onProgress` / `offProgress`。

**生命周期（唯一顺序）：**

1. 工具页 `onMounted`：`tts:probe`。  
2. 工具页 `onBeforeUnmount`：`tts:stopWorker`（抢占，见第 3 节）。  
3. 应用退出：主进程监听 **`will-quit`**。若 worker 仍在，`preventDefault` 一次，`stopWorker`（kill，最多再等 3 秒确认进程消失），然后再次 `app.quit()`。

FFmpeg：复用音视频转码工具的 PATH 检测。未安装则导入失败（参考音必须转码）；wav 合成在参考音已入库后不额外依赖 FFmpeg；mp3 导出需要 FFmpeg。

### 4.4 界面

新工具：`id: 'tts'`，`name: '语音合成'`，`category: 'data'`，组件 `TtsTool.vue`。改 `src/config/tools.ts`、`App.vue`、独立 icon 变量。

布局：

- 左：音色列表（名称 + `durationMs` 格式化）。导入、重命名（可改名/转写/备注）、删除。试听：`tts:readRef` 得到数据后在渲染进程创建 `Blob` + `blob:` URL 赋给 `<audio>`；组件卸载时 `URL.revokeObjectURL`。不做自定义 `file://` 协议。
- 右：当前音色、多行文本、输出目录、输出文件名、格式 wav/mp3、覆盖已存在文件的勾选（默认不勾选）、开始合成。成功后若主进程已有 `shell.showItemInFolder` 则提供「在访达/资源管理器中显示」。
- 环境条：设备、模型、`modelReady`；未就绪显示「下载模型」。

**输出路径默认值：**

- 目录：默认 `app.getPath('desktop')`。用户用 `dialog.openDirectory` 更改时写入 `userData/tts-voices/ui.json` 的 `lastOutputDir`。合成成功不改该字段。下次打开工具若该目录仍存在则用它，否则回退桌面。
- 文件名：默认 `tts-YYYYMMDD-HHmmss` + 当前格式扩展名。用户可改；主进程拼接 `outputPath`。拒绝：空名、包含 `..`、绝对路径、路径分隔符，以及 Windows 非法字符 `:*?"<>|`。

导入：`dialog.openFile` 选音频 + 名称 + 转写（必填）+ 备注（选填）+ 合规一句提示。

错误用 `resultType: 'success' | 'error'`，不弹 `alert`。

### 4.5 依赖与文档

用户本机（不写进 npm `dependencies`）：

- Python 3.10 或 3.11。主进程用 `python3 -c "import sys; print(sys.version_info[:2])"`（Windows 用 `python`）检查。主次版本不是 `(3, 10)` 或 `(3, 11)` 时：`tts:probe` 返回 `success: false`（worker 不启动），文案要求安装 3.10/3.11。不在错误版本上继续 download/synth。
- 按 CosyVoice 官方文档安装依赖；README 写清 Mac (MPS/CPU) 与 Windows CUDA 的 torch 安装命令。
- 不 vendor CosyVoice 源码进本仓库。解析顺序：若设 `COSYVOICE_HOME` 则插入 `sys.path`，然后 `import cosyvoice`。失败见 4.2 `probe`。

模型目录（只下载 probe 选中的一套）：

- CosyVoice 3：`TTS_MODEL_DIR/Fun-CosyVoice3-0.5B/`
- CosyVoice-300M：`TTS_MODEL_DIR/CosyVoice-300M/`

具体 snapshot 仓库名与子文件以实施计划对照 [FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice) 当时的 README 写死版本标签或 commit。下载顺序：ModelScope，失败再 HuggingFace。

`modelReady`：对应目录存在且含上游要求的核心权重文件（实施计划列出文件名清单）。

README：「语音合成」小节覆盖安装、M4 预期、Windows 6 GB 降级、私人录音、MIT 与 Apache。

## 5. 数据流

### 5.1 导入

1. 用户选文件并填转写。  
2. 主进程校验扩展名与转写非空。  
3. FFmpeg 写出临时 wav，检查时长 3～30 秒，记录 `durationMs`。  
4. 生成 UUID，把 wav 放到 `items/<id>/ref.wav`，再更新 `index.json`（先目录后索引）。  
5. 任一步失败则删除已创建的 `items/<id>/`，不改索引（若索引已写则回滚该条）。

### 5.2 合成

1. `probe`；`modelReady === false` 且 `cosyvoiceImportOk === true` 时用户点下载 → `download`。  
2. `load`。  
3. `synth` 写出临时 wav。  
4. 主进程按 `overwrite` 规则落到最终 `outputPath`（wav 移动或 mp3 转码），并删除临时文件。  
5. 成功返回路径。

下载、load、synth、导入互斥（第 3 节）。UI 在互斥锁忙时禁用这些按钮；`stopWorker` 始终可点（若提供）或随页面卸载触发。

## 6. 异常与边界

| 场景 | 行为 |
|------|------|
| 未装 Python | `probe` 失败，文案与 OCR 一致 |
| `import cosyvoice` 失败 | 见 4.2，可管理音色库，不能下载/合成 |
| 未装 FFmpeg | 导入失败；已入库音色可 wav 合成；mp3 失败 |
| 模型未下载 | 可浏览库；合成前须下载 |
| 参考音过短/过长/损坏 | 导入失败 |
| 转写为空 | 导入/更新拒绝 |
| 文本空或超过 2000 字 | 合成拒绝 |
| 输出路径无写权限 / 磁盘满 | 合成失败，清理 partial |
| `index.json` 损坏 | 见 4.1 |
| worker 崩溃 | 见 4.2 重启策略 |
| 应用退出 | `will-quit` + 抢占 kill，最多再等 3 秒 |
| 中文路径 | UTF-8；Windows 注意代码页 |

## 7. 测试与验收

仓库无自动化测试基建。实施后用 `npx vue-tsc --noEmit` 与 `npm run dev` 手工验收。

**P0（M4 24 GB）：**

1. 未装依赖时打开工具，环境条可读。  
2. 按 README 装好后下载模型，进度有反馈。  
3. 导入 5～15 秒自己的 wav + 转写，列表出现该音色（含时长），可试听。  
4. 合成约 50 字中文，得到可播放 wav；再导出 mp3 到桌面默认文件名。  
5. 删除音色后面板不再引用已删 id。  
6. 离开工具后数秒内 Python worker 退出。  
7. 损坏 `index.json` 后打开工具有明确错误，不丢用户未备份的其他目录文件（应用不自动删 `models/`）。

**P1（Windows 1060，不阻塞发版）：**

- `probe` 说明 300M 或 CPU 警告；CUDA 不可用不得显示为 GPU。

## 8. 许可

- 兔丝源码：MIT。  
- CosyVoice 工程与权重：Apache 2.0，用户自行获取。  
- 不 bundling NC/AGPL/Research-only 引擎（ChatTTS、Fish Speech S2、IndexTTS 等）。

## 9. 风险

- 上游 CosyVoice 的 MPS 路径仍在演进；无声或报错时用 `TTS_DEVICE=cpu`，并在 `probe.message` 说明。  
- 模型体积数 GB，首次下载依赖网络（ModelScope 优先）。  
- 1060 + 新 PyTorch 可能无 sm_61：走 CPU 警告，不阻塞 Mac 验收。
