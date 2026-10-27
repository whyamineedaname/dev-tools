import { clipboard, ipcMain } from 'electron'

// ============================================================================
// 本地翻译：对接本机大模型推理服务（Ollama / 任意 OpenAI 兼容端点）
//
// 设计原则：
// - 所有请求只发往 127.0.0.1 或用户自定义的本地地址，不经过任何云端 API；
// - 长文本先按段落切块，逐块流式翻译并实时回传增量，避免长时间无响应；
// - 翻译规则（保留 Markdown 结构 / 代码与占位符、术语表、风格）统一在
//   主进程拼装提示词，渲染层只负责收集参数与展示结果。
// ============================================================================

type TranslateKind = 'ollama' | 'openai'

interface LocalService {
  id: string
  label: string
  kind: TranslateKind
  baseUrl: string
  hint: string
}

interface ModelInfo {
  id: string
  label: string
  size?: string
  family?: string
}

interface ScanResult {
  id: string
  label: string
  kind: TranslateKind
  baseUrl: string
  hint: string
  ok: boolean
  resolvedBaseUrl?: string
  models?: ModelInfo[]
  error?: string
}

interface RunPayload {
  requestId?: string
  baseUrl?: string
  kind?: TranslateKind
  model?: string
  text?: string
  sourceLang?: string
  targetLang?: string
  style?: string
  keepCode?: boolean
  glossary?: string
  temperature?: number
  maxChunkChars?: number
}

/** 内置的常见本机推理服务地址（端口均为各服务默认值） */
const LOCAL_SERVICES: LocalService[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    hint: '默认端口 11434'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    hint: '默认端口 1234'
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8080/v1',
    hint: 'llama-server 默认端口 8080'
  },
  {
    id: 'vllm',
    label: 'vLLM / 其他',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:8000/v1',
    hint: '任意 OpenAI 兼容端点'
  }
]

const PROBE_TIMEOUT_MS = 2500
const IDLE_TIMEOUT_MS = 120000
const DEFAULT_MAX_CHUNK = 1200
/** 单块上下文上限：调大避免长段落被静默截断 */
const NUM_CTX = 8192

const LANG_NAMES: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  pt: '葡萄牙语',
  it: '意大利语',
  ar: '阿拉伯语',
  th: '泰语',
  vi: '越南语',
  hi: '印地语'
}

const STYLE_NAMES: Record<string, string> = {
  general: '通用',
  tech: '技术文档',
  academic: '学术论文',
  casual: '口语对话',
  subtitle: '字幕',
  literal: '逐字直译'
}

// ==================== 基础工具 ====================

function normalizeBaseUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function formatSize(bytes?: number): string | undefined {
  if (!bytes || !Number.isFinite(bytes)) return undefined
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

/** 带超时的 JSON 请求；超时或网络错误返回 null，由调用方决定兜底策略 */
async function tryFetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isEmbeddingModel(name: string): boolean {
  return /embed|bge-|nomic|gte-|reranker/i.test(name)
}

async function probeOllama(baseUrl: string): Promise<ModelInfo[] | null> {
  const data = (await tryFetchJson(`${baseUrl}/api/tags`, PROBE_TIMEOUT_MS)) as {
    models?: Array<{ name?: string; model?: string; size?: number; details?: { family?: string } }>
  } | null
  if (!data || !Array.isArray(data.models)) return null
  return data.models
    .map<ModelInfo>(m => {
      const id = String(m.name || m.model || '')
      return { id, label: id, size: formatSize(m.size), family: m.details?.family }
    })
    .filter(m => m.id && !isEmbeddingModel(m.id))
}

/**
 * OpenAI 兼容端点：baseUrl 可能写成 http://host:port 或 .../v1，
 * 两种写法都尝试一遍，返回真正可用的根地址与模型列表。
 */
async function probeOpenAi(baseUrl: string): Promise<{ root: string; models: ModelInfo[] } | null> {
  const candidates = /\/v\d+$/.test(baseUrl) ? [baseUrl] : [`${baseUrl}/v1`, baseUrl]
  for (const root of candidates) {
    const data = (await tryFetchJson(`${root}/models`, PROBE_TIMEOUT_MS)) as {
      data?: Array<{ id?: string }>
    } | null
    if (data && Array.isArray(data.data)) {
      const models = data.data
        .map<ModelInfo>(m => ({ id: String(m.id || ''), label: String(m.id || '') }))
        .filter(m => m.id && !isEmbeddingModel(m.id))
      return { root, models }
    }
  }
  return null
}

async function probeService(service: LocalService): Promise<ScanResult> {
  const baseUrl = normalizeBaseUrl(service.baseUrl)
  try {
    if (service.kind === 'ollama') {
      const models = await probeOllama(baseUrl)
      if (models) {
        return { ...service, baseUrl, ok: true, resolvedBaseUrl: baseUrl, models }
      }
      // 兜底：某些网关只暴露 OpenAI 兼容接口
      const openai = await probeOpenAi(baseUrl)
      if (openai) {
        return {
          ...service,
          kind: 'openai',
          baseUrl,
          ok: true,
          resolvedBaseUrl: openai.root,
          models: openai.models
        }
      }
      return { ...service, baseUrl, ok: false, error: '未检测到本机服务（可能未启动或端口不同）' }
    }
    const openai = await probeOpenAi(baseUrl)
    if (openai) {
      return { ...service, baseUrl, ok: true, resolvedBaseUrl: openai.root, models: openai.models }
    }
    return { ...service, baseUrl, ok: false, error: '未检测到 OpenAI 兼容服务' }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...service, baseUrl, ok: false, error: msg }
  }
}

/** 自定义地址探测：自动判断是 Ollama 还是 OpenAI 兼容端点 */
async function probeCustom(baseUrlRaw: string): Promise<ScanResult> {
  const baseUrl = normalizeBaseUrl(baseUrlRaw)
  const base: ScanResult = {
    id: 'custom',
    label: '自定义地址',
    kind: 'ollama',
    baseUrl,
    hint: '',
    ok: false
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { ...base, error: '地址需以 http:// 或 https:// 开头' }
  }
  const models = await probeOllama(baseUrl)
  if (models) return { ...base, ok: true, resolvedBaseUrl: baseUrl, models }
  const openai = await probeOpenAi(baseUrl)
  if (openai) {
    return { ...base, kind: 'openai', ok: true, resolvedBaseUrl: openai.root, models: openai.models }
  }
  return { ...base, error: '该地址没有响应可用的模型列表接口' }
}

// ==================== 文本切块 ====================

/** 按句末标点切分超长段落（保留标点） */
function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[。！？；.!?;])\s*/)
  const parts: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (!sentence) continue
    if (buffer && buffer.length + sentence.length > maxChars) {
      parts.push(buffer)
      buffer = ''
    }
    if (sentence.length > maxChars) {
      // 极端情况：单句仍然超长，按字符硬切
      for (let i = 0; i < sentence.length; i += maxChars) {
        parts.push(sentence.slice(i, i + maxChars))
      }
      continue
    }
    buffer += sentence
  }
  if (buffer) parts.push(buffer)
  return parts
}

/** 按空行分段并合并为不超过 maxChars 的块（顺序拼接后仍是原文顺序） */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const paragraphs = normalized.split(/\n[ \t]*\n/)
  const blocks: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      blocks.push(...splitLongParagraph(paragraph, maxChars))
    } else {
      blocks.push(paragraph)
    }
  }
  const chunks: string[] = []
  let current = ''
  for (const block of blocks) {
    if (current && current.length + block.length + 2 > maxChars) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${block}` : block
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [normalized]
}

// ==================== 提示词 ====================

type PromptPayload = Pick<RunPayload, 'sourceLang' | 'style' | 'keepCode' | 'glossary'> & {
  targetLang: string
}

function buildMessages(payload: PromptPayload, chunk: string) {
  const target = LANG_NAMES[payload.targetLang] || payload.targetLang
  const source =
    payload.sourceLang && payload.sourceLang !== 'auto'
      ? LANG_NAMES[payload.sourceLang] || payload.sourceLang
      : ''
  const style = STYLE_NAMES[payload.style || 'general'] || '通用'

  const rules = [
    '1. 只输出译文本身，不要输出原文、解释、说明、拼音、引号或任何前后缀。',
    '2. 完整保留原文的段落结构、换行、Markdown 标记、列表与缩进层级。',
    '3. 数字、日期、单位、公式保持原样。'
  ]
  if (payload.keepCode !== false) {
    rules.push(
      '4. 代码块、行内代码、命令行、文件路径、URL、变量名、占位符（如 {name}、%s、{{var}}）一律原样保留，不要翻译。'
    )
  }
  rules.push(`5. 译文自然地道，符合「${style}」的表达习惯，不要逐字硬译。`)
  rules.push('6. 如果原文已经是目标语言，则原样返回。')

  const system = [
    `你是专业翻译引擎，负责把用户提供的文本翻译成${target}${
      source ? `，源语言为${source}` : '，源语言自动识别'
    }。`,
    '必须严格遵守以下规则：',
    ...rules
  ].join('\n')

  const glossary = String(payload.glossary || '').trim()
  const user = glossary
    ? `术语对照表（必须优先遵守，格式为「原文 = 译文」）：\n${glossary}\n\n待翻译文本：\n${chunk}`
    : chunk

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

// ==================== 流式请求 ====================

interface StreamOptions {
  kind: TranslateKind
  baseUrl: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature: number
  maxTokens: number
  signal: AbortSignal
  touch: () => void
}

/** 逐行解析流式响应；onLine 返回 false 表示遇到结束标记 */
async function readStream(
  res: Response,
  signal: AbortSignal,
  onLine: (line: string) => boolean
): Promise<void> {
  if (!res.body) throw new Error('响应没有可读数据流')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  let drained = false
  try {
    while (!finished) {
      const { done, value } = await reader.read()
      if (done) {
        drained = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (onLine(line) === false) {
          finished = true
          break
        }
      }
    }
    const tail = buffer.trim()
    if (!finished && tail) onLine(tail)
  } finally {
    // 提前结束（[DONE] / 抛错 / 用户取消）时主动释放连接，避免流悬挂
    if (!drained) void reader.cancel().catch(() => undefined)
  }
}

async function streamOllama(opts: StreamOptions, onDelta: (delta: string) => void): Promise<void> {
  const buildBody = (withThink: boolean) => {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      stream: true,
      options: {
        temperature: opts.temperature,
        num_ctx: NUM_CTX,
        num_predict: opts.maxTokens
      }
    }
    // qwen3 等思考模型：关闭思考，避免把思维链当译文返回
    if (withThink) body.think = false
    return body
  }

  let res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(true)),
    signal: opts.signal
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // 老版本 Ollama 不认 think 字段，去掉后重试一次
    if (/think/i.test(detail)) {
      res = await fetch(`${opts.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(false)),
        signal: opts.signal
      })
    }
    if (!res.ok) {
      const retryDetail = await res.text().catch(() => '')
      const message = retryDetail || detail
      throw new Error(
        `Ollama 返回 ${res.status}${message ? `：${message.slice(0, 300)}` : ''}`
      )
    }
  }

  await readStream(res, opts.signal, line => {
    opts.touch()
    let json: { message?: { content?: string }; error?: string; done?: boolean }
    try {
      json = JSON.parse(line) as typeof json
    } catch {
      return true
    }
    if (json.error) throw new Error(json.error)
    if (json.message?.content) onDelta(json.message.content)
    return true
  })
}

async function streamOpenAi(opts: StreamOptions, onDelta: (delta: string) => void): Promise<void> {
  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens
    }),
    signal: opts.signal
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`服务返回 ${res.status}${detail ? `：${detail.slice(0, 300)}` : ''}`)
  }

  await readStream(res, opts.signal, line => {
    if (line.startsWith(':')) return true
    if (line.startsWith('event:')) return true
    if (!line.startsWith('data:')) return true
    const payload = line.slice(5).trim()
    if (!payload) return true
    if (payload === '[DONE]') return false
    opts.touch()
    let json: { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>; error?: { message?: string } }
    try {
      json = JSON.parse(payload) as typeof json
    } catch {
      return true
    }
    if (json.error?.message) throw new Error(json.error.message)
    const choice = json.choices?.[0]
    const delta = choice?.delta?.content ?? choice?.message?.content
    if (delta) onDelta(delta)
    return true
  })
}

// ==================== IPC ====================

interface ActiveRun {
  controller: AbortController
  canceled: boolean
}

const activeRuns = new Map<string, ActiveRun>()

export function registerTranslateIpc(): void {
  // 扫描所有内置本机服务
  ipcMain.handle('translate:scan', async () => {
    const results = await Promise.all(LOCAL_SERVICES.map(service => probeService(service)))
    return { success: true as const, services: results }
  })

  // 探测自定义地址
  ipcMain.handle('translate:probe', async (_event, baseUrl: string) => {
    const result = await probeCustom(baseUrl)
    return { success: true as const, service: result }
  })

  ipcMain.handle('translate:clipboardRead', async () => {
    return { success: true as const, text: clipboard.readText() }
  })

  ipcMain.handle('translate:clipboardWrite', async (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return { success: true as const }
  })

  ipcMain.handle('translate:cancel', async (_event, requestId: string) => {
    const run = activeRuns.get(String(requestId))
    if (!run) return { success: false as const, error: '没有正在进行的翻译' }
    run.canceled = true
    run.controller.abort()
    return { success: true as const }
  })

  ipcMain.handle('translate:run', async (event, payload: RunPayload) => {
    const text = String(payload?.text ?? '')
    if (!text.trim()) return { success: false as const, error: '请输入要翻译的文本' }
    const baseUrl = normalizeBaseUrl(String(payload?.baseUrl || ''))
    if (!baseUrl) return { success: false as const, error: '请先选择或填写本地服务地址' }
    const model = String(payload?.model || '').trim()
    if (!model) return { success: false as const, error: '请先选择要使用的本地模型' }
    const targetLang = String(payload?.targetLang || '').trim()
    if (!targetLang) return { success: false as const, error: '请选择目标语言' }
    const kind: TranslateKind = payload?.kind === 'openai' ? 'openai' : 'ollama'
    const requestId = String(payload?.requestId || `tr-${Date.now()}`)
    const temperature = Math.min(1.5, Math.max(0, Number(payload?.temperature ?? 0.2)))
    const maxChunkChars = Math.min(
      4000,
      Math.max(300, Number(payload?.maxChunkChars) || DEFAULT_MAX_CHUNK)
    )

    const run: ActiveRun = { controller: new AbortController(), canceled: false }
    activeRuns.set(requestId, run)
    const sender = event.sender
    const startedAt = Date.now()

    const send = (channel: string, data: Record<string, unknown>) => {
      if (!sender.isDestroyed()) sender.send(channel, data)
    }

    const chunks = splitIntoChunks(text, maxChunkChars)
    let output = ''

    try {
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index]
        let idleTimer: ReturnType<typeof setTimeout> | null = null
        let idleFired = false
        const touch = () => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            idleFired = true
            run.controller.abort()
          }, IDLE_TIMEOUT_MS)
        }
        touch()

        const messages = buildMessages(
          {
            targetLang,
            sourceLang: payload?.sourceLang,
            style: payload?.style,
            keepCode: payload?.keepCode,
            glossary: payload?.glossary
          },
          chunk
        )
        const streamOptions: StreamOptions = {
          kind,
          baseUrl,
          model,
          messages,
          temperature,
          maxTokens: Math.min(8192, Math.max(512, chunk.length * 2 + 256)),
          signal: run.controller.signal,
          touch
        }

        send('translate:progress', { requestId, index, total: chunks.length })
        const onDelta = (delta: string) => {
          output += delta
          send('translate:delta', { requestId, index, total: chunks.length, delta })
        }

        try {
          if (kind === 'openai') {
            await streamOpenAi(streamOptions, onDelta)
          } else {
            await streamOllama(streamOptions, onDelta)
          }
        } catch (e: unknown) {
          if (run.controller.signal.aborted) {
            throw new Error(
              run.canceled ? '已停止翻译' : idleFired ? `模型 ${IDLE_TIMEOUT_MS / 1000} 秒无响应，已中断` : '已中断'
            )
          }
          throw e
        } finally {
          if (idleTimer) clearTimeout(idleTimer)
        }

        // 块与块之间补回段落分隔（最后一块不加）
        if (index < chunks.length - 1) output += '\n\n'
      }

      const result = {
        success: true as const,
        requestId,
        text: output.trim(),
        elapsedMs: Date.now() - startedAt,
        chunks: chunks.length,
        model,
        sourceChars: text.length
      }
      send('translate:done', result)
      return result
    } catch (e: unknown) {
      const error = run.canceled
        ? '已停止翻译'
        : e instanceof Error
          ? e.message
          : String(e)
      const result = {
        success: false as const,
        requestId,
        error,
        canceled: run.canceled,
        text: output.trim(),
        elapsedMs: Date.now() - startedAt
      }
      send('translate:error', result)
      return result
    } finally {
      activeRuns.delete(requestId)
    }
  })
}
