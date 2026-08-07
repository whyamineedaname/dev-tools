<script setup lang="ts">
import { ref } from 'vue'

const hostname = ref('www.baidu.com')
const loading = ref(false)
const errorMsg = ref('')
const records = ref<Array<{ type: string; value: string }>>([])
const resolvedHost = ref('')

const typeOptions = [
  { id: 'A', label: 'A' },
  { id: 'AAAA', label: 'AAAA' },
  { id: 'CNAME', label: 'CNAME' },
  { id: 'MX', label: 'MX' },
  { id: 'TXT', label: 'TXT' },
  { id: 'NS', label: 'NS' }
]

const selected = ref<string[]>(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'])

async function lookup() {
  errorMsg.value = ''
  records.value = []
  resolvedHost.value = ''
  loading.value = true
  try {
    const types = selected.value.length ? selected.value : undefined
    const result = await window.electronAPI.net.dnsLookup(hostname.value, types)
    if (!result.success) {
      errorMsg.value = result.error
      return
    }
    resolvedHost.value = result.data.hostname
    records.value = result.data.records
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function copyValue(value: string) {
  await navigator.clipboard.writeText(value)
}

function toggleType(id: string) {
  if (selected.value.includes(id)) {
    selected.value = selected.value.filter((x) => x !== id)
  } else {
    selected.value = [...selected.value, id]
  }
}
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>DNS 查询</h2>
      <p>查询 A / AAAA / CNAME / MX / TXT / NS，确认解析是否生效</p>
    </div>

    <div class="toolbar">
      <input
        v-model="hostname"
        class="input"
        type="text"
        placeholder="域名，如 example.com"
        spellcheck="false"
        @keydown.enter="lookup"
      />
      <button type="button" class="btn primary" :disabled="loading" @click="lookup">
        {{ loading ? '查询中…' : '查询' }}
      </button>
    </div>

    <div class="types">
      <button
        v-for="t in typeOptions"
        :key="t.id"
        type="button"
        class="chip"
        :class="{ active: selected.includes(t.id) }"
        @click="toggleType(t.id)"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="errorMsg" class="error">⚠️ {{ errorMsg }}</div>
    <div v-else-if="resolvedHost" class="info">查询主机：{{ resolvedHost }} · {{ records.length }} 条记录</div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>类型</th>
            <th>值</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in records" :key="`${row.type}-${row.value}-${i}`">
            <td class="type">{{ row.type }}</td>
            <td class="mono">{{ row.value }}</td>
            <td>
              <button type="button" class="btn" @click="copyValue(row.value)">复制</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!records.length && !loading && !errorMsg" class="empty">输入域名后点击查询</div>
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
.toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
.input {
  flex: 1;
  height: 36px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 12px;
  font-size: 13px;
  font-family: Consolas, monospace;
}
.btn {
  height: 36px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn.primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.types { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid #e4e7ed;
  background: #fafafa;
  cursor: pointer;
  font-size: 12px;
  color: #606266;
}
.chip.active {
  background: #fff5f8;
  border-color: #ff7eb6;
  color: #c4567a;
}
.error, .info {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.error { background: #fef0f0; color: #f56c6c; }
.info { background: #ecf5ff; color: #409eff; }
.table-wrap {
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th, td {
  padding: 8px 10px;
  border-bottom: 1px solid #f2f2f2;
  text-align: left;
}
th { background: #fafafa; color: #606266; }
.type {
  width: 80px;
  font-weight: 600;
  color: #ff7eb6;
}
.mono {
  font-family: Consolas, monospace;
  word-break: break-all;
}
.empty { padding: 24px; text-align: center; color: #c0c4cc; }
</style>
