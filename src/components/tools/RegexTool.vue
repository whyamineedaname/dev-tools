<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const pattern = ref('')
const flags = ref({ g: true, i: false, m: false, s: false, u: false })
const testText = ref('Hello World 2026\nemail@example.com\n电话：13800138000')
const replaceTo = ref('')
const errorMsg = ref('')

const flagString = computed(() =>
  (Object.keys(flags.value) as Array<keyof typeof flags.value>)
    .filter((k) => flags.value[k])
    .join('')
)

interface MatchItem {
  index: number
  text: string
  groups: string[]
}

const matches = computed<MatchItem[]>(() => {
  errorMsg.value = ''
  if (!pattern.value) return []
  try {
    const re = new RegExp(pattern.value, flagString.value)
    const list: MatchItem[] = []
    if (flags.value.g) {
      let m: RegExpExecArray | null
      const local = new RegExp(pattern.value, flagString.value)
      while ((m = local.exec(testText.value)) !== null) {
        list.push({
          index: m.index,
          text: m[0],
          groups: m.slice(1)
        })
        if (m[0].length === 0) local.lastIndex++
        if (list.length >= 500) break
      }
    } else {
      const m = re.exec(testText.value)
      if (m) {
        list.push({ index: m.index, text: m[0], groups: m.slice(1) })
      }
    }
    return list
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    return []
  }
})

const highlightedHtml = computed(() => {
  if (!pattern.value || errorMsg.value || matches.value.length === 0) {
    return escapeHtml(testText.value)
  }
  const ranges = matches.value.map((m) => ({
    start: m.index,
    end: m.index + m.text.length
  }))
  let html = ''
  let cursor = 0
  const text = testText.value
  for (const r of ranges) {
    if (r.start < cursor) continue
    html += escapeHtml(text.slice(cursor, r.start))
    html += `<mark>${escapeHtml(text.slice(r.start, r.end))}</mark>`
    cursor = r.end
  }
  html += escapeHtml(text.slice(cursor))
  return html
})

const replaced = computed(() => {
  if (!pattern.value || errorMsg.value) return ''
  try {
    const re = new RegExp(pattern.value, flagString.value)
    return testText.value.replace(re, replaceTo.value)
  } catch {
    return ''
  }
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

watch(pattern, () => {
  errorMsg.value = ''
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>正则测试器</h2>
      <p>输入正则与测试文本，实时高亮匹配并支持替换预览</p>
    </div>

    <div v-if="errorMsg" class="error-bar">⚠️ {{ errorMsg }}</div>

    <div class="field">
      <label>正则表达式</label>
      <input v-model="pattern" class="input" type="text" placeholder="例如：\\d+|\\w+@\\w+\\.\\w+" spellcheck="false" />
      <div class="flags">
        <label v-for="(on, key) in flags" :key="key" class="flag">
          <input v-model="flags[key as keyof typeof flags]" type="checkbox" />
          {{ key }}
        </label>
        <span class="flag-preview">/{{ pattern || '...' }}/{{ flagString }}</span>
      </div>
    </div>

    <div class="grid-2">
      <div class="field">
        <label>测试文本</label>
        <textarea v-model="testText" class="textarea" rows="10" spellcheck="false" />
      </div>
      <div class="field">
        <label>匹配高亮（{{ matches.length }} 处）</label>
        <div class="preview" v-html="highlightedHtml" />
      </div>
    </div>

    <div class="field">
      <label>替换为</label>
      <div class="row">
        <input v-model="replaceTo" class="input" type="text" placeholder="可使用 $1、$2 引用捕获组" />
        <button type="button" class="btn" :disabled="!replaced" @click="copyText(replaced)">复制替换结果</button>
      </div>
      <textarea class="textarea mono" rows="4" readonly :value="replaced" placeholder="替换预览…" />
    </div>

    <div v-if="matches.length" class="matches">
      <div class="matches-title">匹配列表</div>
      <div v-for="(m, i) in matches" :key="i" class="match-item">
        <span class="idx">#{{ i + 1 }}</span>
        <code>{{ m.text }}</code>
        <span class="pos">@{{ m.index }}</span>
        <span v-if="m.groups.length" class="groups">组: {{ m.groups.join(' | ') }}</span>
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
.head h2 {
  margin: 0 0 4px;
  font-size: 18px;
  color: #303133;
}
.head p {
  margin: 0 0 14px;
  font-size: 13px;
  color: #909399;
}
.error-bar {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 6px;
  font-size: 13px;
}
.field {
  margin-bottom: 14px;
}
.field > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
  font-weight: 500;
}
.input,
.textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: Consolas, 'Courier New', monospace;
}
.textarea {
  resize: vertical;
  min-height: 120px;
}
.textarea.mono {
  background: #fafafa;
}
.flags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
}
.flag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #606266;
}
.flag-preview {
  margin-left: auto;
  font-family: Consolas, monospace;
  font-size: 12px;
  color: #909399;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.preview {
  min-height: 120px;
  max-height: 280px;
  overflow: auto;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  background: #fafafa;
}
.preview :deep(mark) {
  background: #ffd6e7;
  color: #c4567a;
  border-radius: 2px;
  padding: 0 1px;
}
.row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.btn {
  flex: none;
  padding: 0 14px;
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn:hover:not(:disabled) {
  border-color: #ff7eb6;
  color: #ff7eb6;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.matches-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
.match-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid #f2f2f2;
  font-size: 12px;
}
.idx {
  color: #ff7eb6;
  font-weight: 600;
}
.pos {
  color: #909399;
}
.groups {
  color: #606266;
}
code {
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 4px;
}
@media (max-width: 900px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
