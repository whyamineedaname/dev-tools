<script setup lang="ts">
import { computed, ref } from 'vue'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

const method = ref<Method>('GET')
const url = ref('https://httpbin.org/get')
const headersText = ref('Content-Type: application/json')
const body = ref('')
const timeoutMs = ref(30000)
const loading = ref(false)
const errorMsg = ref('')
const tab = ref<'body' | 'headers'>('body')

const status = ref<number | null>(null)
const statusText = ref('')
const elapsedMs = ref(0)
const responseHeaders = ref<Record<string, string>>({})
const responseBody = ref('')

const methods: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

const showBody = computed(() => !['GET', 'HEAD'].includes(method.value))

const headerLines = computed(() =>
  Object.entries(responseHeaders.value)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
)

const prettyBody = computed(() => {
  const raw = responseBody.value
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
})

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) headers[key] = value
  }
  return headers
}

async function send() {
  errorMsg.value = ''
  loading.value = true
  status.value = null
  statusText.value = ''
  responseHeaders.value = {}
  responseBody.value = ''
  elapsedMs.value = 0
  try {
    const result = await window.electronAPI.http.request({
      method: method.value,
      url: url.value.trim(),
      headers: parseHeaders(headersText.value),
      body: showBody.value ? body.value : undefined,
      timeoutMs: timeoutMs.value
    })
    elapsedMs.value = result.elapsedMs
    if (!result.success) {
      errorMsg.value = result.error
      return
    }
    status.value = result.status
    statusText.value = result.statusText
    responseHeaders.value = result.headers
    responseBody.value = result.body
    tab.value = 'body'
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function copyText(text: string) {
  if (!text) return
  await navigator.clipboard.writeText(text)
}
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>HTTP 客户端</h2>
      <p>本地发送请求，查看状态码、响应头与 Body（无 CORS 限制）</p>
    </div>

    <div class="req-row">
      <select v-model="method" class="method">
        <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="url" class="url" type="text" placeholder="https://api.example.com/path" spellcheck="false" />
      <button type="button" class="btn primary" :disabled="loading" @click="send">
        {{ loading ? '请求中…' : '发送' }}
      </button>
    </div>

    <div class="grid">
      <div class="col">
        <label>请求头（每行 Key: Value）</label>
        <textarea v-model="headersText" class="textarea" rows="6" spellcheck="false" />
        <label class="mt">超时（ms）</label>
        <input v-model.number="timeoutMs" class="num" type="number" min="1000" max="120000" step="1000" />
        <template v-if="showBody">
          <label class="mt">请求体</label>
          <textarea v-model="body" class="textarea" rows="8" spellcheck="false" placeholder='{"key":"value"}' />
        </template>
      </div>

      <div class="col">
        <div class="status-bar" v-if="status !== null || errorMsg">
          <template v-if="status !== null">
            <span class="code" :class="{ ok: status < 400, bad: status >= 400 }">
              {{ status }} {{ statusText }}
            </span>
            <span class="time">{{ elapsedMs }} ms</span>
          </template>
          <span v-if="errorMsg" class="err">{{ errorMsg }}</span>
        </div>

        <div class="tabs">
          <button type="button" class="tab" :class="{ active: tab === 'body' }" @click="tab = 'body'">Body</button>
          <button type="button" class="tab" :class="{ active: tab === 'headers' }" @click="tab = 'headers'">Headers</button>
          <button
            type="button"
            class="btn ghost"
            :disabled="!(tab === 'body' ? prettyBody : headerLines)"
            @click="copyText(tab === 'body' ? prettyBody : headerLines)"
          >
            复制
          </button>
        </div>
        <textarea
          class="textarea out"
          rows="18"
          readonly
          :value="tab === 'body' ? prettyBody : headerLines"
          placeholder="响应内容…"
        />
      </div>
    </div>
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
}
.head h2 { margin: 0 0 4px; font-size: 18px; color: #303133; }
.head p { margin: 0 0 14px; font-size: 13px; color: #909399; }
.req-row { display: flex; gap: 8px; margin-bottom: 14px; }
.method, .url, .num, .btn, .textarea {
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
}
.method { width: 110px; height: 36px; padding: 0 8px; }
.url { flex: 1; height: 36px; padding: 0 10px; font-family: Consolas, monospace; }
.num { width: 120px; height: 32px; padding: 0 8px; }
.btn {
  height: 36px;
  padding: 0 14px;
  cursor: pointer;
  white-space: nowrap;
}
.btn.primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn.ghost { height: 28px; margin-left: auto; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.col label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.mt { margin-top: 10px; }
.textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-family: Consolas, monospace;
  resize: vertical;
}
.textarea.out { background: #fafafa; min-height: 320px; }
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
.code.ok { color: #67c23a; font-weight: 600; }
.code.bad { color: #f56c6c; font-weight: 600; }
.time { color: #909399; }
.err { color: #f56c6c; }
.tabs { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
.tab {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
  cursor: pointer;
  font-size: 12px;
}
.tab.active { background: #fff5f8; border-color: #ff7eb6; color: #c4567a; }
@media (max-width: 960px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
