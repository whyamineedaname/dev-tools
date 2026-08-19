<script setup lang="ts">
import { computed, ref } from 'vue'

interface PortRow {
  protocol: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
}

const portInput = ref('')
const onlyListen = ref(true)
const loading = ref(false)
const killing = ref<number | null>(null)
const errorMsg = ref('')
const rows = ref<PortRow[]>([])
const msg = ref('')

const visibleRows = computed(() => {
  const list = onlyListen.value
    ? rows.value.filter((r) => /LISTEN/i.test(r.state))
    : rows.value
  return list
})

async function query() {
  errorMsg.value = ''
  msg.value = ''
  loading.value = true
  try {
    const raw = portInput.value.trim()
    const port = raw ? Number(raw) : undefined
    if (raw && (!Number.isFinite(port) || port! <= 0 || port! > 65535)) {
      errorMsg.value = '端口需为 1–65535'
      return
    }
    const result = await window.electronAPI.net.listPorts(port)
    if (!result.success) {
      errorMsg.value = result.error
      rows.value = []
      return
    }
    rows.value = result.data
    msg.value = result.data.length
      ? `共 ${result.data.length} 条连接`
      : port
        ? `端口 ${port} 当前无占用`
        : '未找到 TCP 连接'
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function kill(pid: number) {
  if (!confirm(`确认结束进程 PID ${pid}？`)) return
  killing.value = pid
  errorMsg.value = ''
  try {
    const result = await window.electronAPI.net.killPid(pid)
    if (!result.success) {
      errorMsg.value = result.error
      return
    }
    msg.value = `已结束 PID ${pid}`
    await query()
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    killing.value = null
  }
}

void query()
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>端口占用</h2>
      <p>查看谁占用了端口，并可一键结束进程</p>
    </div>

    <div class="toolbar">
      <input
        v-model="portInput"
        class="input"
        type="text"
        placeholder="端口号，如 8080；留空查全部"
        @keydown.enter="query"
      />
      <label class="flag">
        <input v-model="onlyListen" type="checkbox" />
        仅 LISTENING
      </label>
      <button type="button" class="btn primary" :disabled="loading" @click="query">
        {{ loading ? '查询中…' : '查询' }}
      </button>
    </div>

    <div v-if="errorMsg" class="error">⚠️ {{ errorMsg }}</div>
    <div v-else-if="msg" class="info">{{ msg }}</div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>端口</th>
            <th>地址</th>
            <th>状态</th>
            <th>PID</th>
            <th>进程</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in visibleRows" :key="`${row.pid}-${row.localPort}-${row.state}-${i}`">
            <td class="mono">{{ row.localPort }}</td>
            <td class="mono">{{ row.localAddress }}</td>
            <td>{{ row.state }}</td>
            <td class="mono">{{ row.pid }}</td>
            <td>{{ row.processName || '—' }}</td>
            <td>
              <button
                type="button"
                class="btn danger"
                :disabled="killing === row.pid || row.pid <= 0"
                @click="kill(row.pid)"
              >
                {{ killing === row.pid ? '结束中…' : '结束' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!visibleRows.length && !loading" class="empty">暂无数据</div>
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
.input {
  width: 240px;
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
}
.flag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}
.btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn.primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn.danger { color: #f56c6c; border-color: #f5c2c2; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.error, .info {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.error { background: #fef0f0; color: #f56c6c; }
.info { background: #f0f9eb; color: #67c23a; }
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
  white-space: nowrap;
}
th { background: #fafafa; color: #606266; font-weight: 600; }
.mono { font-family: Consolas, monospace; }
.empty { padding: 24px; text-align: center; color: #c0c4cc; }
</style>
