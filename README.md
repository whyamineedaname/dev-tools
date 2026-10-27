# 兔丝

跨平台桌面工具箱（Windows / macOS）。把常用的文本处理、文档转换、阅读、下载、翻译、语音合成等能力收进一个本地应用，双击即可使用，所有数据都在本机处理。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> 最新版本：**v1.0.1** · [前往 GitHub Releases 下载](https://github.com/whyamineedaname/dev-tools/releases)

## 本次更新（v1.0.1）

- **新增工具**：OCR 文字识别、房贷计算器（支持提前还款与利率调整、导出 PDF）、语音合成（CosyVoice 本地音色库）、本地翻译（Ollama / OpenAI 兼容）、音乐下载、文件目录、单位换算
- **新增能力**：B 站视频下载器（分 P + 清晰度选择）、数据同步（MySQL / PostgreSQL / Elasticsearch 互转）、文档转 PDF 在 macOS 上优先走 LibreOffice、MP4 转 WebP 在 FFmpeg 缺 `libwebp` 时自动抽帧后备编码
- **Windows 兼容修复**：路径分隔符不再写死反斜杠（文档转 Markdown、文档转 PDF、MP4 转 WebP、音视频转码、图片压缩）、PDF 导出中文字体按平台自动选择、后台调用 Python / FFmpeg 不再闪控制台窗口
- **临时目录可迁移**：「文件目录」里可把 OCR 截图、下载中间文件、语音合成临时 wav 改到其他磁盘，避免占满系统盘（Windows 通常是 C 盘）
- **新增测试**：`npm run test:units` 覆盖 18 类单位换算的定义值、往返一致性与油耗倒数关系

## 快速开始

### 1. 下载应用

从 [GitHub Releases 页面](https://github.com/whyamineedaname/dev-tools/releases) 下载最新版本，任选其一：

| 系统 | 文件 | 适合谁 |
|------|------|--------|
| Windows | `tools-Setup-1.0.1.exe` | 安装版，可自定义安装目录，并创建桌面快捷方式 |
| Windows | `tools-1.0.1-portable.exe` | **推荐**。便携版，拷贝到任意目录双击即可，无需安装 |
| macOS | `tools-1.0.1-arm64.dmg` | Apple 芯片（M 系列）Mac |
| macOS | `tools-1.0.1-x64.dmg` | Intel Mac |

系统要求：Windows 10 / 11（64 位）、macOS 11.0 及以上。

> macOS 首次打开未签名应用时，请在「访达」中右键应用图标 →「打开」，或前往「系统设置 → 隐私与安全性」点击「仍要打开」。

### 2. 按需配置环境

应用本体不依赖 Node.js。只有部分工具需要额外环境，**用不到可以跳过**。

#### 文档转换（文档转 Markdown / 文档转 PDF）

需要本机安装 **Python 3**，并确保命令行里能执行 `python`（Windows）或 `python3`（macOS）。

**Windows：**

1. 打开 [Python 官网](https://www.python.org/downloads/) 下载安装包。
2. 安装时勾选 **Add python.exe to PATH**。
3. 打开「命令提示符」或 PowerShell，执行：

```bash
python --version
pip install "markitdown[pdf]" python-pptx pillow reportlab pywin32
```

**macOS：**

```bash
python3 --version
pip3 install markitdown python-pptx pillow reportlab
```

| 包名 | 作用 |
|------|------|
| `markitdown` | 各类文档转 Markdown |
| `python-pptx` | 处理 PPT / PPTX |
| `pillow` | 图片读写 |
| `reportlab` | 生成 PDF |
| `pywin32` | （仅 Windows）调用本机 Office / WPS 转换旧版 `.ppt` |

> `.ppt` 转 PDF 仅 Windows 支持（依赖 Microsoft Office / WPS COM）；macOS 上请先用 Office / Keynote 另存为 `.pptx` 再转换。

#### OCR 文字识别

需要本机安装 **Python 3**，并执行：

```bash
pip install rapidocr onnxruntime opencv-python pymupdf
```

| 包名 | 作用 |
|------|------|
| `rapidocr` | 文字识别引擎（离线本地推理，模型内置） |
| `onnxruntime` | RapidOCR 的推理后端 |
| `opencv-python` | 二维码 / 条形码识别 |
| `pymupdf` | 扫描版 PDF 逐页转图片 |

> 首次运行 RapidOCR 会加载模型（包内自带、不额外下载），CPU 下单张图片通常 1 秒内出结果。

#### 视频转动图（MP4 转 WebP） / 音视频转码


需要本机安装 **FFmpeg**，并加入 PATH。Homebrew 的 FFmpeg 9 通常未编译 `libwebp`，工具会自动改用内置编码器，不必为此重装 FFmpeg。

**Windows：** 下载 [FFmpeg](https://ffmpeg.org/download.html)（Windows builds），解压后把 `bin` 目录加入系统环境变量 PATH。

**macOS：**

```bash
brew install ffmpeg
```

验证：

```bash
ffmpeg -version
```

#### 人声分离

需要本机安装 **Python 3**，并执行（macOS 用 `pip3`）：

```bash
pip install demucs        # Windows
pip3 install demucs       # macOS
```

`demucs` 会附带安装 PyTorch（体积较大）。首次分离时应用会自动下载 AI 模型（约 300MB），请保持网络畅通。CPU 下分离一首 4 分钟歌曲约需 3-8 分钟，属于正常速度。

#### 语音合成

需要 **Python 3.10 或 3.11**、**FFmpeg**，以及本机安装 [CosyVoice](https://github.com/FunAudioLLM/CosyVoice)（Apache 2.0）。权重在工具内首次「下载模型」，不打进安装包。

**macOS（Apple 芯片，推荐 M4 16 GB 以上统一内存）：**

```bash
python3 --version   # 须为 3.10 或 3.11
brew install ffmpeg
git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
cd CosyVoice
pip3 install -r requirements.txt
```

把 CosyVoice 仓库路径写入环境变量 `COSYVOICE_HOME`（写入 `~/.zshrc` 后重启应用），例如：

```bash
export COSYVOICE_HOME="$HOME/CosyVoice"
```

若在本仓库旁克隆为 `dev-tools/CosyVoice` 并在其下创建 `.venv` 安装依赖，开发模式下应用会自动使用该路径，可不设环境变量。

**macOS 注意：** 官方 `requirements.txt` 含 CUDA 索引，在 Mac 上直接 `pip install -r requirements.txt` 常会卡在 `pyworld`（403 / 找不到包）。请去掉 CUDA 相关行后再装，或：

```bash
cd CosyVoice
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -i https://pypi.org/simple/ \
  --extra-index-url '' 
# 若仍失败，去掉 requirements.txt 顶部两行 --extra-index-url（cu121 / onnxruntime-cuda）后重试
```

首次在工具里下载 Fun-CosyVoice3 权重（约数 GB，优先 ModelScope）。合成走本机 MPS/CPU，不是实时配音。

**Windows：** 同样需要 Python 3.10/3.11、FFmpeg、`COSYVOICE_HOME`。GTX 1060 级 6 GB 显存会降级 CosyVoice-300M 或 CPU，速度慢且可能失败，请以 Mac 或更大显存机器为主。

请只导入你自己的录音或已获授权的音频。

#### 本地翻译（可选）

需要本机运行一个**本地大模型推理服务**，应用只负责调用它 —— 文本不会离开本机，也不消耗任何云端额度。

推荐 [Ollama](https://ollama.com/)（安装后自带命令行）：

```bash
ollama pull qwen3:8b     # 约 5 GB，中英互译效果稳定
ollama list              # 确认服务与模型就绪
```

工具的「本地翻译」页会自动探测 `127.0.0.1:11434`。同样支持任何 **OpenAI 兼容**端点，例如 LM Studio（默认 `1234`）、llama.cpp `llama-server`（默认 `8080`）、vLLM（默认 `8000`），在界面里换成对应地址即可。

> 若使用其他推理服务，只要提供 `/v1/models` 与 `/v1/chat/completions` 即可被自动识别。自定义地址填 `http://主机:端口` 或 `http://主机:端口/v1` 都能识别。

#### 音乐下载（可选）

需要本机安装 **Python 3**，并安装音乐搜索库 [musicdl](https://github.com/CharlesPikachu/musicdl)：

**Windows：**

```bash
python --version
python -m pip install musicdl
```

**macOS：**

```bash
python3 --version
pip3 install musicdl
```

装好后打开「音乐下载」页，会显示已就绪的 17 个音源；缺失时工具内会提示执行上面的安装命令。

> 大多数音源无需登录即可搜索；如需更高音质或会员曲目，可在界面填写自己账号的 Cookie（仅保存在本机，不会上传）。

#### 数据同步（可选）

需要 **Python 3** 与对应数据库驱动，按你实际用到的库安装即可：

```bash
# Windows
python -m pip install sqlalchemy pymysql psycopg2-binary elasticsearch

# macOS
pip3 install sqlalchemy pymysql psycopg2-binary elasticsearch
```

| 包 | 用途 |
|----|------|
| `sqlalchemy` | 连接 MySQL / PostgreSQL |
| `pymysql` | MySQL 驱动 |
| `psycopg2-binary` | PostgreSQL 驱动 |
| `elasticsearch` | Elasticsearch / OpenSearch 客户端 |

> 数据库账号密码保存在本机 LocalStorage（明文），请勿在共享电脑上填写生产库的高权限账号；建议使用只具备目标表写权限的专用账号。

#### 视频下载器（B 站）

依赖 **FFmpeg**（与上文音视频转码共用，装一次即可）。下载的是分离的音视频流，最后用 `ffmpeg -c copy` 无损合并，所以 FFmpeg 必须在 `PATH` 里能被找到。

**Windows：** 到 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 下载 `ffmpeg-release-essentials.zip`，解压后把 `bin` 目录加入系统「环境变量 → Path」，重开应用即可。

#### 不需要额外环境的工具

JSON 格式化、加解密、正则测试器、时间戳转换、文本对比、配置格式互转、Cron 解析、剪贴板历史、文档阅读器、取色器、EXIF 查看、图片拼图、二维码、单位换算、房贷计算器、主题管理、菜单管理、文件目录、端口占用、DNS 查询 —— 装好应用即可用。

> 「图片去背景」首次运行可能下载 AI 模型，请保持网络畅通。

### 3. 启动

- Windows 便携版：双击 `tools-1.0.1-portable.exe`
- Windows 安装版：运行 `tools-Setup-1.0.1.exe` 后从桌面快捷方式或开始菜单打开「兔丝」
- macOS：打开 `兔丝.app`（拖动到「应用程序」文件夹更方便）

左侧是分类菜单，点击分类后选择具体工具。

> macOS 使用「取色器」或 OCR「截图识别」时，首次会提示需要「屏幕录制」权限，请在「系统设置 → 隐私与安全性 → 屏幕录制」中开启。

---

## 工具功能一览

共 6 个分类 34 个工具。标「可选」的环境依赖见上一节，不装也能用其余工具。

### 文本处理

#### JSON 格式化

把杂乱的 JSON 整理成可读格式，或压缩成单行。

- 支持粘贴文本，也支持打开本地 `.json` 文件
- 一键格式化 / 压缩
- 支持转义、去转义
- 格式错误时会提示具体原因

**适合：** 调试接口返回、整理配置文件。

#### 加解密

常用编码与加解密集合，结果可一键复制。

| 能力 | 效果 |
|------|------|
| Base64 | 文本 ↔ Base64 |
| URL | URL 编码 / 解码 |
| Hash | 计算 MD5、SHA 等摘要 |
| AES | 对称加密 / 解密（需自行保管密钥） |
| RSA | 生成密钥对，非对称加密 / 解密（支持 PEM / Base64） |
| Unicode | Unicode 编码 / 解码 |
| UUID / 密码 | 批量生成 UUID v4；可配置字符集的随机密码 |

**适合：** 日常编码转换、简易加解密、校验摘要、生成标识与口令。

#### 正则测试器

实时验证正则表达式。

- 支持常用标志：`g` / `i` / `m` / `s` / `u`
- 测试文本匹配高亮
- 列出匹配位置与捕获组
- 替换预览（支持 `$1` 等引用）

**适合：** 写爬虫规则、校验表单、调试文本提取。

#### 时间戳转换

Unix 时间戳与日期互转，并对照多时区。

- 秒 / 毫秒切换
- 一键填入当前时间
- 日期时间 ↔ 时间戳
- 上海、东京、UTC、纽约等常用时区对照

**适合：** 读日志、对接口字段、排查时区问题。

#### 文本对比

左右粘贴文本，按行显示差异。

- 新增行绿色、删除行红色
- 可忽略空白差异
- 支持左右交换

**适合：** 对比配置、接口返回、文案改动。

#### 配置格式互转

JSON / YAML / TOML / XML 互相转换。

- 本地解析与序列化，不上传文件
- 一键交换源/目标格式
- 结果可复制

**适合：** 改配置、对接不同系统的配置格式。

#### Cron 解析

输入 Cron 表达式，查看接下来多次执行时间。

- 支持常用预设（每分钟、工作日 9 点等）
- 可选时区与条数
- 复制下次执行时间

**适合：** 写定时任务、核对调度是否符合预期。

#### 剪贴板历史

自动记录最近复制的文本与图片。

- 后台轮询系统剪贴板
- 文本 / 图片分类浏览
- 一键写回剪贴板
- 历史保存在本机用户目录（最多约 40 条）

**适合：** 找回刚复制过又被覆盖的内容。

#### 本地翻译

调用本机大模型服务做翻译，**文本不出本机**，可离线使用。

- 自动探测本机 Ollama / LM Studio / llama.cpp / vLLM，也可手填任意 OpenAI 兼容地址
- 源语言可自动识别，中 / 英 / 日 / 韩 / 法 / 德 等 14 种目标语言一键切换
- 长文本按段落自动切块，译文**逐字流式输出**，随时可停止
- 可选「翻译风格」：通用、技术文档、学术论文、口语对话、字幕、逐字直译
- 代码块、命令、路径、URL、变量名与 `{占位符}` 原样保留，不参与翻译
- 支持术语表（每行 `原文 = 译文`），强制统一专有名词译法
- 译文可一键复制，或「放回原文」继续做二次翻译
- 可读系统剪贴板作为原文；`Cmd/Ctrl + Enter` 开始翻译，`Esc` 停止
- 参数（服务、模型、语言、风格、术语表）自动记住

**适合：** 阅读英文文档与论文、翻译报错信息、中英互译、整理多语言素材。

---

### 数据文件

#### 文档转 Markdown

把办公文档、PDF 等转换成 Markdown 文本。

- 常见支持：PDF、Word（`.docx`）、Excel（`.xlsx`）、PPT（`.pptx`）、TXT、HTML、MD 等
- 选择源文件与输出路径后一键转换
- 依赖本机 Python + `markitdown` 等包（见上方环境配置）

**适合：** 把资料整理成可编辑的 Markdown，方便二次加工或交给 AI 阅读。

#### 文档转 PDF

把 PPT / 图片等转成 PDF。

- 支持：`.ppt`、`.pptx`、`.jpg`、`.jpeg`、`.png`
- macOS 优先用 LibreOffice 转 `.ppt` / `.pptx`（备选 WPS，兜底纯 Python）；Windows `.ppt` 走本机 Office / WPS COM
- 图片与 PPTX 兜底走 Python 脚本生成 PDF

**适合：** 汇报材料统一成 PDF、截图/幻灯片归档。

#### OCR 文字识别

基于 RapidOCR 的本地离线文字识别，四种模式：

| 模式 | 说明 |
|------|------|
| 截图识别 | 全屏划选区域，识别其中的文字 |
| 批量识别 | 一次选择多张图片，逐个提取文字 |
| PDF 识别 | 扫描版 PDF 逐页识别，保留页码分段 |
| 二维码 | 识别图片 / 截图中的二维码与条形码 |

- 完全本地运行，图片不上传
- 结果一键复制
- 依赖本机 Python 3 + `pip install rapidocr onnxruntime opencv-python pymupdf`
- macOS 使用「截图识别」需在「系统设置 → 隐私与安全性 → 屏幕录制」中为「兔丝」开启权限

**适合：** 从截图、扫描件、宣传图中提取文字和链接。

#### 文档阅读器

本地阅读器，支持常见电子书与 PDF。

| 能力 | 说明 |
|------|------|
| 格式 | PDF、EPUB、MOBI、AZW3 等 |
| 阅读记忆 | 同一文件再次打开会回到上次位置 |
| 最近阅读 | 启动空白页展示最近打开的文档 |
| PDF 画笔 | 自由标记，颜色 / 粗细可调 |
| PDF 橡皮 | 擦除画笔笔迹 |
| PDF 笔记 | 点击页面添加带标签的笔记，可侧栏浏览 |
| 快捷键 | `←` / `→` 翻页；`↑` / `↓` 滚动页面 |

阅读进度与注解保存在本机用户目录，按文件内容识别，换路径一般也能对上。

**适合：** 本地看 PDF / 电子书，边看边标记，下次接着读。

#### MP4 转 WebP

把短视频转成 WebP 动图。

- 支持 `.mp4`、`.m4v`、`.mov`
- 可指定输出目录与文件名
- 依赖本机 FFmpeg

**适合：** 做表情包、网页动图、体积更小的循环动画。

#### 音视频转码

基于本机 FFmpeg 的通用转码面板。

| 模式 | 效果 |
|------|------|
| 转 MP3 | 视频/音频导出为 MP3 |
| 抽音频 | 仅导出音轨（MP3 / AAC / WAV / 原样拷贝） |
| 压视频 | H.264 + AAC，可调 CRF 与最大宽度 |

支持截取起始秒与时长。依赖本机 FFmpeg。

**适合：** 提取 BGM、压缩体积、统一导出音频。

#### 人声分离

用本地 AI 模型（Demucs）把歌曲拆分成多轨。

| 模式 | 效果 |
|------|------|
| 人声 + 伴奏 | 拆成两轨：干声与伴奏 |
| 四轨分离 | 人声 / 鼓 / 贝斯 / 其他 |

- 分离过程显示实时进度，可随时取消
- 输出 WAV，可选同时转为 MP3（需 FFmpeg）
- 依赖本机 Python 3 + `pip install demucs`；首次运行会下载模型，请保持网络畅通

**适合：** 做伴奏、提取干声、翻唱练习、混音素材。

#### 语音合成

本地私人音色库：导入自己的参考音频（3～30 秒）和转写，用 CosyVoice 把文本导出为 WAV / MP3。

- 音色保存在本机用户目录，不联网拉取社区角色包
- 首次需下载模型；离开本工具会结束 Python 推理进程
- 依赖 Python 3.10/3.11、FFmpeg、本机 CosyVoice（`COSYVOICE_HOME`）

**适合：** 用自己的声音朗读文稿、本地试听配音。

---

### 颜色图片

#### 取色器

屏幕任意位置取色（可跨到其他窗口）。

- 点击吸管后到屏幕上点选
- 回显颜色，并支持复制开发常用参数（如 HEX）
- 保留最近取色历史

**适合：** 对标设计稿、抄网页配色、UI 调试。

#### 图片去背景

一键抠图，去掉背景并导出透明 PNG。

- 支持拖拽或选择本地图片
- 本地 AI 模型处理（首次可能需下载模型）
- 处理后可预览并保存为 PNG

**适合：** 证件照换底、商品白底图、做透明素材。

#### 二维码

本地生成与识别，无需联网。

- 文本 / 链接生成二维码，可调尺寸与纠错级别
- 保存 PNG 或复制图片
- 从图片识别二维码内容

**适合：** 分享链接、扫码调试、本地物料制作。

#### 图片压缩

批量裁剪、缩小尺寸并压缩体积。

- 拖拽 / 多选图片
- 在预览图上拖动四角自由裁剪，也可锁定 1:1、4:3、3:4、16:9
- 限制最大宽度、调节质量
- 导出 JPEG / PNG / WebP
- 动图 WebP 逐帧裁剪，保留动画、循环和帧延迟
- 单张或整批保存

**适合：** 发图前压体积、统一缩略图尺寸。

#### EXIF 查看

查看并清理照片的 EXIF 元数据。

- 显示格式、尺寸、拍摄参数、时间、GPS 等信息
- 覆盖相机与手机常见 EXIF 标签，可读化的时间和参数
- 一键重编码去除 EXIF，保护位置隐私

**适合：** 检查照片隐私信息、核对拍摄参数、发布前清理元数据。

#### 图片拼图

把多张图片拼合成一张大图。

| 模式 | 效果 |
|------|------|
| 宫格拼图 | 等分拼接，行列可调（1-6 行/列） |
| 左右拼 | 多张等高分栏 |
| 长图拼接 | 多张等宽上下堆叠 |
| 自由画布 | 拖拽摆放、缩放，自定画布比例 |

支持间隔与背景色，自由模式可导出透明 PNG。

**适合：** 发九宫格、做长截图、对比图、简单排版。

---

### 网络调试

#### HTTP 客户端

轻量本地请求工具（类似简易 Postman）。

- 支持 GET / POST / PUT / PATCH / DELETE / HEAD
- 自定义请求头与 Body
- 查看状态码、耗时、响应头、响应体（JSON 自动格式化）
- 主进程发请求，不受页面 CORS 限制

**适合：** 调试接口、核对线上/本地服务是否通。

#### 端口占用

查看本机 TCP 端口占用，并可结束进程。

- 输入端口（如 `8080`）精确查询，或留空看全部
- 显示 PID、进程名、状态
- 一键 `taskkill` 结束占用进程

**适合：** 「谁占了 8080」这类本地排障。

#### DNS 查询

查询域名解析记录。

- 支持 A / AAAA / CNAME / MX / TXT / NS
- 可勾选要查的类型
- 结果一键复制

**适合：** 确认解析是否生效、对照 CDN / 邮件配置。

#### 视频下载器（B 站）

粘贴视频链接，选择分 P 与清晰度后下载到本地。

- 支持完整链接、`BV` 号、`av` 号
- 多分 P 视频可单独勾选要下载的集数
- 清晰度按码率 / 分辨率 / 编码列出，可挑画质与编码（H.264 / H.265 / AV1）
- 可选填 Cookie（`SESSDATA`）以获取登录后可见的高清画质
- 音视频流下载完后用 FFmpeg `-c copy` 无损合并为 mp4，不重新编码

**适合：** 留存自己上传或已获授权的视频、离线看教程。

> 仅用于下载你有权保存的内容，请遵守平台用户协议与著作权规定；清晰度越高下载体积越大，注意磁盘空间。

#### 数据同步

在 MySQL、PostgreSQL、Elasticsearch 之间按字段搬运数据。

- 源 / 目标各自选类型（MySQL / PostgreSQL / Elasticsearch）、填连接信息与表名，一键查询字段
- 字段按名称自动匹配（忽略大小写与下划线），也可手动调整，并做字段类型校验
- 目标端按主键 upsert 写入（目标无主键时用 `id` 字段），可设置批大小（默认 500）
- 结果给出总数、新增、更新、耗时与错误条数
- 连接任务可保存到本机，下次直接选用，不必重填

**适合：** 数据库迁移、把业务表同步到 ES 做检索、例行补数。

> 任务配置（含数据库密码）以明文保存在本机 LocalStorage，建议使用只具备目标表权限的专用账号，避免在共享电脑上填生产库账号。

#### 音乐下载

搜索歌曲或解析歌单，批量下载音频与歌词。

- 17 个音源：酷我、酷狗、网易云、QQ、咪咕、千千、汽水、5sing、苹果、Spotify、SoundCloud、Qobuz、TIDAL、Joox、Jamendo、Deezer、StreetVoice
- 两种模式：按关键词搜歌，或粘贴歌单 / 专辑链接解析
- 结果表显示歌名、歌手、专辑、格式、大小、时长与来源，可全选后一次下载
- 可选填 Cookie 获取会员音质；下载有进度条，可中途取消
- 音频与歌词（lrc）分别落盘，格式随音源而定（常见 mp3 / flac / m4a）；保存目录与音源勾选会记住

**适合：** 整理自己收藏的歌单、给离线设备备歌。

> 文件名中的 Windows 非法字符（`\ / : * ? " < > |`）会自动替换为下划线，避免保存失败。请仅下载你有权获取的内容。

---

### 计算工具

#### 房贷计算器

支持等额本息 / 等额本金，可设置多组提前还款与利率调整。

- 两种还款方式分别计算，结果含调整后的月供变化
- 可添加多组「提前还款 / 利率调整 / 两者同时」，逐期生效
- 输出逐月还款明细与逐年汇总，一键导出 PDF

**适合：** 买房前算月供、比较提前还款方案。

#### 单位换算

长度、面积、体积、质量等 **18 类 165 个单位**互逆换算，纯本机计算，不联网。

- **左右两栏都能输入**：改动任意一侧，另一侧实时反算，正向与反向是同一套逻辑
- 中间 `⇄` 一键互换两侧数值与单位
- 单位下拉**支持别名搜索**：输入 `lb` / `lbs` / `pound` / `磅` 都能找到磅
- 输入写法支持 `3/8`（分数）、`5'11"`（英尺英寸）、`1e-3`（科学计数法）、`1,234.5`（千分位）、全角数字
- 精度可选 3 / 4 / 6 / 8 / 10 位有效数字，过大过小的量自动切科学计数法（`1×10⁻⁹`）
- 同名单位一律带制式后缀与说明：加仑(US) / 加仑(UK)、盎司(常衡) / 盎司(金衡)、马力(机械) / 马力(公制) / 马力(电气)
- 分类与单位选择自动记住，切回同一分类时恢复上次用的单位对

**适合：** 换算国外尺寸与体重、轮胎胎压（bar ↔ psi）、油耗（L/100km ↔ mpg）、硬盘容量（TB ↔ GiB）、宽带速率（Mbit/s ↔ MB/s）。

> 单位系数全部采用**精确定义值**（如 1 in = 25.4 mm、1 lb = 453.59237 g），并由 `npm run test:units` 的断言表兜底：33 项测试覆盖定义值恒等式、温度锚点（-40 °C = -40 °F）、油耗倒数关系，以及**全部 18 类单位两两互转的往返一致性**。修改 `src/config/units.ts` 后请重新运行该测试。

---

### 应用管理

#### 主题管理

自定义界面配色与背景图。

- 多套主题方案可新建 / 重命名 / 删除 / 切换，默认主题不可删除
- 7 项主题色（主色、侧边栏底色、强调文字等）逐项取色
- 6 个区域可分别设置背景图（主画面、导航顶部 / 菜单 / 底部等），本地图片自动缩放平铺
- 改动即时预览，背景图可一键恢复默认

**适合：** 长时间盯屏时换护眼配色、给工具箱配个顺眼的主题。

#### 菜单管理

自定义分类与工具的图标。

- 分类图标与每个工具图标都可单独更换
- 支持 png / jpg / svg 等常见图片，选中后自动存入用户目录
- 单个条目可恢复默认（未改过的条目按钮置灰）
- 改完立即生效，无需重启

**适合：** 把常用工具换成一眼能认出的图标。

#### 文件目录

管理应用的临时文件与数据目录。

- **临时目录可改**：OCR 截图、视频下载中间文件、语音合成临时 wav 都写在它下面
- 默认用系统临时目录（Windows 通常在 `C:\Users\<用户名>\AppData\Local\Temp`），可改到 D 盘等空间更大的分区
- 自定义目录不可写（无权限、磁盘被移除）时自动回退系统临时目录，并在界面上说明原因
- 应用数据目录（配置、音色库、自定义图标）只读展示，点击可直接打开
- 选目录时默认从当前临时目录开始，可一键恢复默认

**适合：** 系统盘紧张，想把临时文件挪到数据盘。

> Windows 便携版（exe）默认把临时文件写在系统用户目录，长期存放大文件前建议先在这里改到非系统盘。

---

## 环境依赖速查

| 工具 | 需要额外下载 / 配置 |
|------|---------------------|
| JSON 格式化 | 无 |
| 加解密 | 无 |
| 正则测试器 | 无 |
| 时间戳转换 | 无 |
| 文本对比 | 无 |
| 配置格式互转 | 无 |
| Cron 解析 | 无 |
| 剪贴板历史 | 无 |
| 本地翻译 | 本机推理服务（推荐 Ollama `ollama pull qwen3:8b`）或任意 OpenAI 兼容端点 |
| 文档转 Markdown | Python 3 + `pip install "markitdown[pdf]" python-pptx pillow reportlab pywin32` |
| 文档转 PDF | Python 3 + 上述 pip 包；macOS 另需 LibreOffice（推荐），Windows `.ppt` 需 Office / WPS |
| OCR 文字识别 | Python 3 + `pip install rapidocr onnxruntime opencv-python pymupdf` |
| 文档阅读器 | 无 |
| MP4 转 WebP | FFmpeg 并加入 PATH（缺 `libwebp` 时自动抽帧后备编码） |
| 音视频转码 | FFmpeg 并加入 PATH |
| 人声分离 | Python 3 + `pip install demucs`；首次联网下载模型 |
| 语音合成 | Python 3.10/3.11 + FFmpeg + CosyVoice（`COSYVOICE_HOME`）；首次联网下载权重 |
| 取色器 | 无（macOS 需屏幕录制权限） |
| 图片去背景 | 首次可能需联网下载模型 |
| 二维码 | 无 |
| 图片压缩 | 无 |
| EXIF 查看 | 无 |
| 图片拼图 | 无 |
| HTTP 客户端 | 无 |
| 端口占用 | 无（Windows 用 netstat / taskkill，macOS / Linux 用 lsof / kill） |
| DNS 查询 | 无 |
| 视频下载器 | FFmpeg 并加入 PATH |
| 数据同步 | Python 3 + `pip install sqlalchemy pymysql psycopg2-binary elasticsearch` |
| 音乐下载 | Python 3 + `pip install musicdl` |
| 房贷计算器 | 无 |
| 单位换算 | 无 |
| 主题管理 | 无 |
| 菜单管理 | 无 |
| 文件目录 | 无 |

---

## 常见问题

**Q：双击便携版没反应，或杀毒软件拦截？**  
A：部分安全软件会误报未签名的 exe。可添加信任，或改用安装版。

**Q：macOS 打开提示「无法验证开发者」？**  
A：应用未签名，请在「访达」中右键应用 →「打开」，或到「系统设置 → 隐私与安全性」点击「仍要打开」。

**Q：macOS 取色器 / OCR 截图识别全黑？**  
A：需要在「系统设置 → 隐私与安全性 → 屏幕录制」中为「兔丝」开启权限，然后重启应用。

**Q：文档转换提示找不到 `python`？**  
A：Windows 安装 Python 时勾选加入 PATH，重开命令行执行 `python --version`；macOS 执行 `python3 --version`。仍不行可重启电脑后再试。

**Q：MP4 转 WebP 失败？**  
A：确认 `ffmpeg -version` 可用。未配置 PATH 时应用找不到 FFmpeg。

**Q：阅读位置丢了？**  
A：进度按文件内容哈希保存。文件被大幅修改后可能被视为新文件；换电脑则不会同步。

**Q：去背景很慢或一直卡住？**  
A：首次使用会下载模型，请检查网络。大图处理也会更久一些。

**Q：人声分离很慢？**  
A：CPU 下属于正常现象（一首 4 分钟歌曲约 3-8 分钟）。首次运行还需下载模型。若本机有 NVIDIA 显卡，安装 GPU 版 PyTorch 可明显提速。

**Q：语音合成提示找不到 CosyVoice / Python 版本不对？**  
A：需要 Python 3.10 或 3.11（`python3 --version`）。克隆官方 CosyVoice 仓库并安装依赖后，设置 `COSYVOICE_HOME` 指向该仓库再启动兔丝。首次使用请在工具内下载模型，并确认已安装 FFmpeg。

**Q：本地翻译提示「未检测到服务」？**  
A：先确认推理服务已启动：Ollama 执行 `ollama list`，并确保端口为默认的 `11434`（LM Studio 为 `1234`）。启动后回到工具点「重新检测」。若服务跑在其他端口，把地址填在「自定义地址」里再点「重新检测」。

**Q：本地翻译很慢，或第一次调用要等很久？**  
A：首次调用需要把模型加载进显存 / 内存，等待一次属正常。之后速度取决于机器与模型大小：7~8B 量化模型在 CPU 上约每秒几个字，有独显会明显更快。小模型译不动的长文本，可换更大的模型。

**Q：翻译出现乱码、漏译，或把代码也翻了？**  
A：优先选指令跟随更好的对话模型（如 `qwen3:8b`），并保持「代码 / 路径 / 占位符保持原样」勾选。术语较多的材料，在「术语表」里按 `原文 = 译文` 逐行补充即可稳定译法。

**Q：音乐下载提示「未安装 musicdl」？**  
A：需要 Python 3 和 `musicdl`。Windows 执行 `python -m pip install musicdl`，macOS 执行 `pip3 install musicdl`，装完重开应用。若同时提示找不到 Python，请确认安装时勾选了「Add python.exe to PATH」。

**Q：数据同步提示缺少依赖，或连不上数据库？**  
A：先确认驱动装好：`python -c "import sqlalchemy, pymysql"`（PostgreSQL 换成 `psycopg2`）。Elasticsearch 版本需与服务端匹配，提示不兼容时按提示执行 `pip install -U elasticsearch`。MySQL 8 默认认证方式偶尔会导致 PyMySQL 报认证错误，可在服务端为该账号改用 `mysql_native_password`。连接串里的主机、端口、库名三项都要填对，远程库还需确认防火墙放行。

**Q：视频下载器合并失败，或下载下来没有声音？**  
A：合并依赖 FFmpeg，请先 `ffmpeg -version` 确认可用且已加入 PATH。没有声音通常是只下载到了视频流——未填 Cookie 时只列出免费清晰度，部分曲目需要登录态，填入自己账号的 `SESSDATA` 再试。

**Q：Windows 上临时文件把 C 盘塞满了？**  
A：OCR 截图、视频下载中间文件、语音合成临时 wav 默认写在系统临时目录（Windows 通常在 C 盘）。打开「应用管理 → 文件目录」把临时目录改到其他分区，之后的新任务都会用新目录；已经生成的旧文件需要手动删除。

**Q：Windows 上还有哪些地方和 macOS 不同？**  
A：三点：命令是 `python` 而不是 `python3`；FFmpeg 需要自己下载并加入 PATH；`.ppt` 这类老格式转 PDF 依赖本机 Office 或 WPS。路径分隔符、中文字体、后台进程都已在应用内按平台处理，后台调用 Python / FFmpeg 时不会弹出黑色的控制台窗口。

**Q：为什么 1 TB 硬盘在系统里只显示 931 GB？**  
A：硬盘厂商按十进制标称容量（1 TB = 1000 GB = 10¹² 字节），操作系统按二进制显示（1 TiB = 1024 GiB = 2⁴⁰ 字节），两者相差 1024³ ÷ 1000³ ≈ 7.3%。在「单位换算 → 存储容量」里可以直接验证：1 TB = 931.32 GiB。同一分类里也提供 KB / KiB、MB / MiB、GB / GiB 两套单位。

**Q：为什么油耗换 mpg 不是乘以一个系数？**  
A：mpg 是「每加仑跑多少英里」，L/100km 是「跑 100 公里烧多少升」，两者是**倒数关系**而非倍数关系：`L/100km = 235.214583 ÷ mpg(US)`。所以 8 L/100km 对应 29.4 mpg，而不是 1881。工具已按倒数处理，英制加仑用另一个系数（282.480936）。

**Q：单位换算的位数能保证精确保留吗？**  
A：换算用双精度浮点计算，显示时按有效数字收敛，因此能消掉浮点末位噪声（例如 1 mi 换算成英寸会显示 63360，而不是 63360.00000000001），并在真正发生舍入时才标 `≈`。日常换算与工程常用场景足够；若需要「任意精度有理数」级别的严格运算，可以再扩展换算内核。

---

## 本地开发

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（Vite + Electron，改渲染层热更新）
npm run typecheck    # TypeScript / Vue 类型检查
npm run test:units   # 单位换算断言测试（esbuild 打包 + node:test）
npm run build        # 构建，安装包输出到 release/
```

新增一个工具需要三步：在 `src/config/tools.ts` 注册元信息 → 新建 `src/components/tools/<X>Tool.vue` → 在 `src/App.vue` 的 `toolComponents` 里挂上组件。

写代码时注意 Windows 兼容：

- 渲染进程一律通过 preload 暴露的 `window.electronAPI` 调用主进程能力，不要直接 `require('electron')`。
- 路径拼接不要写死分隔符：先取 `window.electronAPI.platform === 'win32' ? '\\' : '/'`，再交给 `joinPath` / `dirname` / `basename` 这类小函数处理（写法可参考 `src/components/tools/DocToPdfTool.vue` 顶部）。
- 主进程 spawn Python / FFmpeg 时带上 `windowsHide: true`，否则 Windows 上会闪黑窗。

---

## 许可证

本项目基于 [MIT License](./LICENSE) 开源，可自由使用、修改与分发。
