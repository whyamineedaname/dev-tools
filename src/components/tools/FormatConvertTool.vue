<script setup lang="ts">
import { computed, ref } from 'vue'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

type Fmt = 'json' | 'yaml' | 'toml' | 'xml'

const input = ref('{\n  "name": "兔丝",\n  "version": "0.1.0",\n  "enabled": true\n}')
const output = ref('')
const fromFmt = ref<Fmt>('json')
const toFmt = ref<Fmt>('yaml')
const errorMsg = ref('')

const formats: { id: Fmt; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'xml', label: 'XML' }
]

const canConvert = computed(() => fromFmt.value !== toFmt.value)

function parseInput(text: string, fmt: Fmt): unknown {
  if (fmt === 'json') return JSON.parse(text)
  if (fmt === 'yaml') return yamlLoad(text)
  if (fmt === 'toml') return parseToml(text)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  })
  return parser.parse(text)
}

function serialize(data: unknown, fmt: Fmt): string {
  if (fmt === 'json') return JSON.stringify(data, null, 2)
  if (fmt === 'yaml') return yamlDump(data, { lineWidth: 100 })
  if (fmt === 'toml') {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('TOML 顶层必须是对象')
    }
    return stringifyToml(data as Record<string, unknown>)
  }
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  '
  })
  const root =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? data
      : { root: data }
  return builder.build(root)
}

function convert() {
  errorMsg.value = ''
  try {
    if (!canConvert.value) {
      errorMsg.value = '源格式与目标格式不能相同'
      return
    }
    const data = parseInput(input.value, fromFmt.value)
    output.value = serialize(data, toFmt.value)
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    output.value = ''
  }
}

function swap() {
  const t = fromFmt.value
  fromFmt.value = toFmt.value
  toFmt.value = t
  if (output.value) {
    input.value = output.value
    output.value = ''
  }
}

async function copyOut() {
  if (!output.value) return
  await navigator.clipboard.writeText(output.value)
}

function clearAll() {
  input.value = ''
  output.value = ''
  errorMsg.value = ''
}
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>配置格式互转</h2>
      <p>JSON / YAML / TOML / XML 互相转换，本地完成</p>
    </div>

    <div class="toolbar">
      <select v-model="fromFmt" class="select">
        <option v-for="f in formats" :key="f.id" :value="f.id">{{ f.label }}</option>
      </select>
      <button type="button" class="btn" @click="swap">⇄</button>
      <select v-model="toFmt" class="select">
        <option v-for="f in formats" :key="f.id" :value="f.id">{{ f.label }}</option>
      </select>
      <button type="button" class="btn primary" @click="convert">转换</button>
      <button type="button" class="btn" :disabled="!output" @click="copyOut">复制结果</button>
      <button type="button" class="btn" @click="clearAll">清空</button>
    </div>

    <div v-if="errorMsg" class="error">⚠️ {{ errorMsg }}</div>

    <div class="grid">
      <div class="col">
        <label>输入（{{ fromFmt.toUpperCase() }}）</label>
        <textarea v-model="input" class="textarea" rows="16" spellcheck="false" />
      </div>
      <div class="col">
        <label>输出（{{ toFmt.toUpperCase() }}）</label>
        <textarea class="textarea" rows="16" readonly :value="output" placeholder="转换结果…" />
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
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.select, .btn {
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
}
.select { padding: 0 10px; }
.btn { padding: 0 12px; cursor: pointer; }
.btn.primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn:hover:not(:disabled) { border-color: #ff7eb6; color: #ff7eb6; }
.btn.primary:hover { color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.error {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 6px;
  font-size: 13px;
}
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.col label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 320px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 10px;
  font-size: 13px;
  font-family: Consolas, 'Courier New', monospace;
  resize: vertical;
}
@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
