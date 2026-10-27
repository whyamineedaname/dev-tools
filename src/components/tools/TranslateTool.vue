<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// 本地翻译：调用本机大模型推理服务（Ollama / LM Studio / llama.cpp 等）
// 文本仅发送到本机地址，不经过任何云端接口。

const STORAGE_KEY = 'tusi.translate.config'
const CUSTOM_ID = 'custom'

const LANGUAGES = [
  { value: 'auto', label: '自动识别' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁体中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
  { value: 'fr', label: '法语' },
  { value: 'de', label: '德语' },
  { value: 'es', label: '西班牙语' },
  { value: 'ru', label: '俄语' },
  { value: 'pt', label: '葡萄牙语' },
  { value: 'it', label: '意大利语' },
  { value: 'ar', label: '阿拉伯语' },
  { value: 'th', label: '泰语' },
  { value: 'vi', label: '越南语' }
]

const TARGET_LANGUAGES = LANGUAGES.filter(l => l.value !== 'auto')

const STYLES = [
  { value: 'general', label: '通用' },
  { value: 'tech', label: '技术文档' },
  { value: 'academic', label: '学术论文' },
  { value: 'casual', label: '口语对话' },
  { value: 'subtitle', label: '字幕' },
  { value: 'literal', label: '逐字直译' }
]

const SAMPLE = `Local-first software keeps your data on your own machine, which means translation can run entirely offline. Most desktop toolboxes already ship a dozen utilities; adding a local translator is only useful when it respects the same privacy promise as the rest of the app.

When you connect the tool to a local inference server, nothing leaves your computer. The model streams its answer token by token, so long documents feel responsive even on a CPU.`

// ---------- 服务与模型 ----------
const services = ref<TranslateServiceInfo[]>([])
const activeServiceId = ref('ollama')
const customUrl = ref('http://127.0.0.1:11434')
const scanning = ref(false)
const models = ref<TranslateModelInfo[]>([])
const model = ref('')
const baseUrl = ref('http://127.0.0.1:11434')
const kind = ref<'ollama' | 'openai'>('ollama')
const serviceMessage = ref('')
const serviceState = ref<'ok' | 'warn' | 'error'>('warn')

// ---------- 翻译参数 ----------
const sourceLang = ref('auto')
const targetLang = ref('zh-CN')
const style = ref('general')
const keepCode = ref(true)
const glossary = ref('')
const temperature = ref(0.2)
const showAdvanced = ref(false)

// ---------- 文本与运行状态 ----------
const inputText = ref('')
const outputText = ref('')
const running = ref(false)
const requestId = ref('')
const progress = ref<{ index: number; total: number }>({ index: 0, total: 0 })
const elapsedMs = ref(0)
const statusKind = ref<'success' | 'error' | ''>('')
const statusMessage = ref('')
const outputEl = ref<HTMLElement | null>(null)

let offDelta: (() => void) | null = null
let offProgress: (() => void) | null = null

// ---------- 工具函数 ----------
/** 粗略判断语种：中日韩字符占比高判为中文，拉丁字母占比高判为英文 */
function detectLang(text: string): string {
  const sample = text.slice(0, 2000)
  if (!sample.trim()) return ''
  const cjk = (sample.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const latin = (sample.match(/[A-Za-z]/g) || []).length
  const total = sample.replace(/\s/g, '').length || 1
  if (cjk / total >= 0.25) return 'zh-CN'
  if (latin / total >= 0.5) return 'en'
  return ''
}

/** 模型名越「规整」越可能是官方通用模型（qwen3:8b 优于 qwen3-cn-cs:latest 这类微调版） */
function canonicalScore(id: string): number {
  const base = id.split(':')[0]
  const segments = base.split(/[-_]/).filter(Boolean).length
  const hasSizeTag = /:(?:\d+(?:\.\d+)?b|latest)/i.test(id) ? 1 : 0
  return 100 - segments * 10 + hasSizeTag * 5
}

/** 挑选默认模型：优先多语种通用对话模型，避开代码 / 推理 / 微调专用模型 */
function pickModel(list: TranslateModelInfo[]): string {
  if (!list.length) return ''
  if (model.value && list.some(m => m.id === model.value)) return model.value
  const families = [/qwen3/i, /qwen/i, /glm/i, /deepseek/i, /gemma/i, /llama/i, /mistral/i, /yi[-_:]/i]
  for (const pattern of families) {
    const candidates = list.filter(m => pattern.test(m.id) && !/coder|code|r1|reason/i.test(m.id))
    if (candidates.length) {
      return [...candidates].sort((a, b) => canonicalScore(b.id) - canonicalScore(a.id))[0].id
    }
  }
  for (const pattern of families) {
    const hit = list.find(m => pattern.test(m.id))
    if (hit) return hit.id
  }
  return list[0].id
}

function setServiceState(state: 'ok' | 'warn' | 'error', message: string) {
  serviceState.value = state
  serviceMessage.value = message
}

function setStatus(kindValue: 'success' | 'error' | '', message: string) {
  statusKind.value = kindValue
  statusMessage.value = message
}

// ---------- 配置持久化 ----------
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const cfg = JSON.parse(raw) as Record<string, unknown>
    if (typeof cfg.sourceLang === 'string') sourceLang.value = cfg.sourceLang
    if (typeof cfg.targetLang === 'string') targetLang.value = cfg.targetLang
    if (typeof cfg.style === 'string') style.value = cfg.style
    if (typeof cfg.keepCode === 'boolean') keepCode.value = cfg.keepCode
    if (typeof cfg.glossary === 'string') glossary.value = cfg.glossary
    if (typeof cfg.temperature === 'number') temperature.value = cfg.temperature
    if (typeof cfg.activeServiceId === 'string') activeServiceId.value = cfg.activeServiceId
    if (typeof cfg.customUrl === 'string') customUrl.value = cfg.customUrl
    if (typeof cfg.model === 'string') model.value = cfg.model
  } catch {
    // 配置损坏时忽略，使用默认值
  }
}

function saveConfig() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sourceLang: sourceLang.value,
        targetLang: targetLang.value,
        style: style.value,
        keepCode: keepCode.value,
        glossary: glossary.value,
        temperature: temperature.value,
        activeServiceId: activeServiceId.value,
        customUrl: customUrl.value,
        model: model.value
      })
    )
  } catch {
    // 存储不可用时静默失败，不影响翻译
  }
}

// ---------- 服务探测 ----------
const serviceOptions = computed(() => [
  ...services.value.map(s => ({
    id: s.id,
    label: s.ok ? s.label : `${s.label}（未检测到）`,
    hint: s.hint
  })),
  { id: CUSTOM_ID, label: '自定义地址', hint: '任意 OpenAI 兼容 / Ollama 端点' }
])

async function scanServices() {
  scanning.value = true
  setServiceState('warn', '正在检测本机推理服务…')
  try {
    const res = await window.electronAPI.translate.scan()
    services.value = res.services || []
    const current = services.value.find(s => s.id === activeServiceId.value)
    if (!current || (!current.ok && services.value.some(s => s.ok))) {
      if (!current?.ok) {
        const fallback = services.value.find(s => s.ok)
        if (fallback) activeServiceId.value = fallback.id
      }
    }
    applyService()
  } catch (e) {
    setServiceState('error', `检测失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    scanning.value = false
  }
}

function applyService() {
  if (activeServiceId.value === CUSTOM_ID) {
    void probeCustom()
    return
  }
  const service = services.value.find(s => s.id === activeServiceId.value)
  if (!service) {
    models.value = []
    setServiceState('warn', '服务列表为空，点「重新检测」再试')
    return
  }
  baseUrl.value = service.resolvedBaseUrl || service.baseUrl
  kind.value = service.kind
  models.value = service.models || []
  model.value = pickModel(models.value)
  if (!service.ok) {
    setServiceState('error', `${service.error || '未检测到服务'} · 启动后点「重新检测」`)
  } else if (!models.value.length) {
    setServiceState('warn', `已连接 ${baseUrl.value}，但该服务还没有可用模型`)
  } else {
    setServiceState('ok', `已连接 ${baseUrl.value} · ${models.value.length} 个可用模型`)
  }
}

async function probeCustom() {
  const url = customUrl.value.trim()
  if (!url) {
    setServiceState('error', '请填写自定义地址')
    return
  }
  scanning.value = true
  setServiceState('warn', `正在探测 ${url} …`)
  try {
    const res = await window.electronAPI.translate.probe(url)
    const service = res.service
    if (service.ok) {
      baseUrl.value = service.resolvedBaseUrl || service.baseUrl
      kind.value = service.kind
      models.value = service.models || []
      model.value = pickModel(models.value)
      setServiceState(
        'ok',
        `已连接 ${baseUrl.value}（${service.kind === 'ollama' ? 'Ollama' : 'OpenAI 兼容'}）· ${models.value.length} 个可用模型`
      )
    } else {
      models.value = []
      setServiceState('error', service.error || '该地址不可用')
    }
  } catch (e) {
    models.value = []
    setServiceState('error', `探测失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    scanning.value = false
  }
}

// ---------- 语言与操作 ----------
function swapLanguages() {
  const detected = detectLang(inputText.value)
  const from = sourceLang.value === 'auto' ? detected || 'en' : sourceLang.value
  const to = targetLang.value
  sourceLang.value = to
  targetLang.value = from === to ? (from === 'zh-CN' ? 'en' : 'zh-CN') : from
}

const sameLang = computed(
  () => sourceLang.value !== 'auto' && sourceLang.value === targetLang.value
)

const inputChars = computed(() => inputText.value.length)

/** 中英混排的粗略字数：中日韩按字计，拉丁按词计 */
const inputWords = computed(() => {
  const text = inputText.value
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const words = (text.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ').match(/[A-Za-z0-9_'’-]+/g) || []).length
  return cjk + words
})

const speed = computed(() => {
  if (!elapsedMs.value) return 0
  return Math.round((outputText.value.length / elapsedMs.value) * 1000)
})

function readClipboard() {
  void window.electronAPI.translate.clipboardRead().then(res => {
    if (res.text) {
      inputText.value = res.text
      setStatus('success', '已读取剪贴板内容')
    } else {
      setStatus('error', '剪贴板为空')
    }
  })
}

function copyResult() {
  if (!outputText.value) {
    setStatus('error', '还没有译文可复制')
    return
  }
  void window.electronAPI.translate.clipboardWrite(outputText.value).then(() => {
    setStatus('success', '译文已复制到剪贴板')
  })
}

function applyResultToInput() {
  if (!outputText.value) return
  inputText.value = outputText.value
  outputText.value = ''
  elapsedMs.value = 0
  setStatus('success', '已把译文放回原文框')
}

function clearAll() {
  inputText.value = ''
  outputText.value = ''
  elapsedMs.value = 0
  progress.value = { index: 0, total: 0 }
  setStatus('', '')
}

function useSample() {
  inputText.value = SAMPLE
  targetLang.value = 'zh-CN'
  setStatus('', '')
}

async function translate() {
  if (running.value) return
  if (!inputText.value.trim()) {
    setStatus('error', '请输入要翻译的文本')
    return
  }
  if (!model.value) {
    setStatus('error', '没有可用模型，请先启动本机推理服务并点「重新检测」')
    return
  }
  outputText.value = ''
  elapsedMs.value = 0
  progress.value = { index: 0, total: 0 }
  running.value = true
  setStatus('', '')
  const id = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  requestId.value = id
  try {
    const res = await window.electronAPI.translate.run({
      requestId: id,
      baseUrl: baseUrl.value,
      kind: kind.value,
      model: model.value,
      text: inputText.value,
      sourceLang: sourceLang.value,
      targetLang: targetLang.value,
      style: style.value,
      keepCode: keepCode.value,
      glossary: glossary.value,
      temperature: temperature.value
    })
    elapsedMs.value = res.elapsedMs || 0
    if (res.success) {
      outputText.value = res.text
      setStatus(
        'success',
        `翻译完成 · ${res.chunks} 段 · ${(res.elapsedMs / 1000).toFixed(1)} 秒 · ${res.model}`
      )
    } else {
      if (res.text) outputText.value = res.text
      setStatus('error', res.error)
    }
  } catch (e) {
    setStatus('error', `翻译失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running.value = false
    requestId.value = ''
  }
}

async function stop() {
  if (!requestId.value) return
  await window.electronAPI.translate.cancel(requestId.value)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void translate()
    return
  }
  if (event.key === 'Escape' && running.value) {
    event.preventDefault()
    void stop()
  }
}

// ---------- 生命周期 ----------
onMounted(() => {
  loadConfig()
  offDelta = window.electronAPI.translate.onDelta(event => {
    if (event.requestId !== requestId.value) return
    outputText.value += event.delta
  })
  offProgress = window.electronAPI.translate.onProgress(event => {
    if (event.requestId !== requestId.value) return
    progress.value = { index: event.index + 1, total: event.total }
  })
  void scanServices()
})

onBeforeUnmount(() => {
  offDelta?.()
  offProgress?.()
  if (requestId.value) void window.electronAPI.translate.cancel(requestId.value)
})

watch([sourceLang, targetLang, style, keepCode, glossary, temperature, model, customUrl, activeServiceId], saveConfig)
watch(activeServiceId, () => applyService())
watch(outputText, () => {
  const el = outputEl.value
  if (el && running.value) el.scrollTop = el.scrollHeight
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>本地翻译</h2>
      <p>调用本机大模型服务（Ollama / LM Studio / llama.cpp）离线翻译，文本不出本机</p>
    </div>

    <!-- 服务与模型 -->
    <div class="service-bar">
      <div class="service-row">
        <span class="dot" :class="serviceState" />
        <select v-model="activeServiceId" class="select" :disabled="running">
          <option v-for="s in serviceOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
        <input
          v-if="activeServiceId === CUSTOM_ID"
          v-model="customUrl"
          class="input url"
          placeholder="http://127.0.0.1:11434"
          spellcheck="false"
          :disabled="running"
        />
        <select v-model="model" class="select model" :disabled="running || !models.length">
          <option v-if="!models.length" value="">
            {{ scanning ? '正在检测…' : '未发现可用模型' }}
          </option>
          <option v-for="m in models" :key="m.id" :value="m.id">
            {{ m.label }}{{ m.size ? ` · ${m.size}` : '' }}
          </option>
        </select>
        <button
          type="button"
          class="btn"
          :disabled="scanning || running"
          @click="activeServiceId === CUSTOM_ID ? probeCustom() : scanServices()"
        >
          {{ scanning ? '检测中…' : '重新检测' }}
        </button>
      </div>
      <div class="service-hint" :class="serviceState">{{ serviceMessage }}</div>
    </div>

    <!-- 语言与主操作 -->
    <div class="lang-row">
      <select v-model="sourceLang" class="select lang" :disabled="running">
        <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
      </select>
      <button type="button" class="btn icon" title="交换语言" :disabled="running" @click="swapLanguages">⇄</button>
      <select v-model="targetLang" class="select lang" :disabled="running">
        <option v-for="l in TARGET_LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
      </select>
      <button type="button" class="btn primary" :disabled="running" @click="translate">
        {{ running ? '翻译中…' : '开始翻译' }}
      </button>
      <button v-if="running" type="button" class="btn" @click="stop">停止</button>
      <button type="button" class="btn ghost" :disabled="running" @click="showAdvanced = !showAdvanced">
        高级选项{{ showAdvanced ? ' ▲' : ' ▼' }}
      </button>
    </div>

    <!-- 高级选项 -->
    <div v-if="showAdvanced" class="advanced">
      <div class="field">
        <label>翻译风格</label>
        <select v-model="style" class="select" :disabled="running">
          <option v-for="s in STYLES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
      <div class="field">
        <label>随机度 {{ temperature.toFixed(1) }}</label>
        <input v-model.number="temperature" type="range" min="0" max="1" step="0.1" :disabled="running" />
      </div>
      <label class="field check">
        <input v-model="keepCode" type="checkbox" :disabled="running" />
        代码 / 路径 / 占位符保持原样
      </label>
      <div class="field wide">
        <label>术语表（每行一条，格式：原文 = 译文）</label>
        <textarea
          v-model="glossary"
          class="textarea small"
          rows="3"
          spellcheck="false"
          placeholder="prompt = 提示词&#10;token = 词元"
          :disabled="running"
        />
      </div>
    </div>

    <!-- 原文与译文 -->
    <div class="panes">
      <div class="pane">
        <div class="pane-head">
          <span>原文</span>
          <span class="pane-actions">
            <button type="button" class="link" :disabled="running" @click="readClipboard">读剪贴板</button>
            <button type="button" class="link" :disabled="running" @click="useSample">示例</button>
            <button type="button" class="link" :disabled="running" @click="clearAll">清空</button>
          </span>
        </div>
        <textarea
          v-model="inputText"
          class="textarea main"
          rows="14"
          spellcheck="false"
          placeholder="粘贴或输入要翻译的文本，按 Cmd/Ctrl + Enter 开始翻译"
          :disabled="running"
          @keydown="onKeydown"
        />
        <div class="pane-foot">
          <span>{{ inputChars }} 字符 · 约 {{ inputWords }} 字</span>
          <span v-if="sameLang" class="warn-text">源语言与目标语言相同</span>
        </div>
      </div>

      <div class="pane">
        <div class="pane-head">
          <span>译文</span>
          <span class="pane-actions">
            <span v-if="running && progress.total" class="progress">
              第 {{ progress.index }}/{{ progress.total }} 段
            </span>
            <button type="button" class="link" :disabled="!outputText || running" @click="copyResult">复制</button>
            <button type="button" class="link" :disabled="!outputText || running" @click="applyResultToInput">
              放回原文
            </button>
          </span>
        </div>
        <div ref="outputEl" class="output">
          <template v-if="outputText">
            <span class="output-text">{{ outputText }}</span><span v-if="running" class="caret" />
          </template>
          <span v-else class="placeholder">
            {{ running ? '模型正在生成译文…' : '译文会在这里流式显示' }}
          </span>
        </div>
        <div class="pane-foot">
          <span v-if="elapsedMs">
            {{ (elapsedMs / 1000).toFixed(1) }} 秒 · {{ outputText.length }} 字符 · {{ speed }} 字符/秒
          </span>
          <span v-else class="muted">离线推理，首次调用需要加载模型，可能稍慢</span>
        </div>
      </div>
    </div>

    <div v-if="statusMessage" class="status" :class="statusKind">{{ statusMessage }}</div>
  </div>
</template>

<style scoped>
.tool-card {
  height: 100%;
  overflow: auto;
  background: #fff;
  border-radius: 8px;
  padding: 16px 18px 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  box-sizing: border-box;
}
.head h2 { margin: 0 0 4px; font-size: 18px; color: #303133; }
.head p { margin: 0 0 14px; font-size: 13px; color: #909399; }

.service-bar {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fafafa;
}
.service-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.service-hint { margin-top: 8px; font-size: 12px; color: #909399; }
.service-hint.ok { color: #67c23a; }
.service-hint.warn { color: #e6a23c; }
.service-hint.error { color: #f56c6c; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #dcdfe6;
  flex: 0 0 auto;
}
.dot.ok { background: #67c23a; }
.dot.warn { background: #e6a23c; }
.dot.error { background: #f56c6c; }

.select,
.input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #303133;
  box-sizing: border-box;
  max-width: 100%;
}
.select:disabled,
.input:disabled,
.textarea:disabled { background: #f5f7fa; color: #a8abb2; cursor: not-allowed; }
.select.model { flex: 1 1 200px; min-width: 160px; }
.input.url { flex: 1 1 220px; min-width: 180px; font-family: Consolas, monospace; }
.select.lang { width: 130px; }

.btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #303133;
  white-space: nowrap;
}
.btn:hover:not(:disabled) { border-color: #ff7eb6; color: #ff7eb6; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn.primary {
  background: #ff7eb6;
  border-color: #ff7eb6;
  color: #fff;
  font-weight: 600;
  min-width: 96px;
}
.btn.primary:hover:not(:disabled) { background: #ff5c9d; border-color: #ff5c9d; color: #fff; }
.btn.ghost { color: #606266; }
.btn.icon { padding: 0 10px; font-size: 15px; line-height: 1; }

.lang-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.advanced {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: #fcfcfd;
}
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #606266; }
.field.check { flex-direction: row; align-items: center; gap: 6px; height: 32px; }
.field.wide { flex: 1 1 100%; }
.field input[type='range'] { width: 160px; }

.panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.pane { display: flex; flex-direction: column; }
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
  color: #303133;
  font-weight: 600;
}
.pane-actions { display: inline-flex; align-items: center; gap: 10px; font-weight: 400; }
.progress { font-size: 12px; color: #e6a23c; }
.link {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  color: #ff7eb6;
  cursor: pointer;
}
.link:disabled { color: #c0c4cc; cursor: not-allowed; }

.textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
}
.textarea.main {
  min-height: 300px;
  font-family: Consolas, 'Courier New', monospace;
}
.textarea.small { font-family: Consolas, 'Courier New', monospace; resize: vertical; }

.output {
  min-height: 300px;
  max-height: 520px;
  overflow: auto;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  background: #fbfbfc;
  font-size: 13px;
  line-height: 1.7;
  color: #303133;
  white-space: pre-wrap;
  word-break: break-word;
}
.placeholder { color: #c0c4cc; }
.caret {
  display: inline-block;
  width: 6px;
  height: 14px;
  margin-left: 2px;
  vertical-align: -2px;
  background: #ff7eb6;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }

.pane-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
.warn-text { color: #e6a23c; }
.muted { color: #c0c4cc; }

.status {
  margin-top: 12px;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 6px;
  word-break: break-word;
}
.status.success { background: #f0f9eb; color: #67c23a; }
.status.error { background: #fef0f0; color: #f56c6c; }

@media (max-width: 900px) {
  .panes { grid-template-columns: 1fr; }
  .textarea.main, .output { min-height: 200px; }
}
</style>
