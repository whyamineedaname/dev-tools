<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'

const nowTick = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const inputTs = ref(String(Math.floor(Date.now() / 1000)))
const inputUnit = ref<'s' | 'ms'>('s')
const inputDate = ref('')
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')

const commonZones = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris'
]

const parsedMs = computed(() => {
  const raw = inputTs.value.trim()
  if (!/^-?\d+$/.test(raw)) return null
  const n = Number(raw)
  return inputUnit.value === 's' ? n * 1000 : n
})

const fromTs = computed(() => {
  if (parsedMs.value == null || Number.isNaN(parsedMs.value)) return null
  const d = new Date(parsedMs.value)
  if (Number.isNaN(d.getTime())) return null
  return d
})

function formatInZone(date: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    }).format(date)
  } catch {
    return '无效时区'
  }
}

const localIso = computed(() => (fromTs.value ? fromTs.value.toISOString() : ''))
const localStr = computed(() =>
  fromTs.value ? formatInZone(fromTs.value, timezone.value) : ''
)

const zoneRows = computed(() => {
  if (!fromTs.value) return []
  return commonZones.map((z) => ({
    zone: z,
    text: formatInZone(fromTs.value!, z)
  }))
})

function useNow() {
  const ms = Date.now()
  nowTick.value = ms
  inputUnit.value = 's'
  inputTs.value = String(Math.floor(ms / 1000))
  syncDateFromTs()
}

function syncDateFromTs() {
  if (!fromTs.value) return
  const d = fromTs.value
  const pad = (n: number) => String(n).padStart(2, '0')
  inputDate.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function convertDateToTs() {
  if (!inputDate.value) return
  const d = new Date(inputDate.value)
  if (Number.isNaN(d.getTime())) return
  inputUnit.value = 's'
  inputTs.value = String(Math.floor(d.getTime() / 1000))
}

async function copyText(text: string) {
  if (!text) return
  await navigator.clipboard.writeText(text)
}

watch(inputTs, () => syncDateFromTs())
watch(inputUnit, () => syncDateFromTs())

useNow()
timer = setInterval(() => {
  nowTick.value = Date.now()
}, 1000)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>时间戳转换</h2>
      <p>Unix 时间戳与日期互转，并对照常用时区</p>
    </div>

    <div class="now-bar">
      <span>当前：{{ Math.floor(nowTick / 1000) }}（秒） / {{ nowTick }}（毫秒）</span>
      <button type="button" class="btn" @click="useNow">填入现在</button>
    </div>

    <div class="grid-2">
      <div class="field">
        <label>时间戳</label>
        <div class="row">
          <input v-model="inputTs" class="input" type="text" spellcheck="false" />
          <select v-model="inputUnit" class="select">
            <option value="s">秒</option>
            <option value="ms">毫秒</option>
          </select>
          <button type="button" class="btn" @click="copyText(inputTs)">复制</button>
        </div>
      </div>
      <div class="field">
        <label>本地日期时间</label>
        <div class="row">
          <input v-model="inputDate" class="input" type="datetime-local" step="1" />
          <button type="button" class="btn btn-primary" @click="convertDateToTs">转为时间戳</button>
        </div>
      </div>
    </div>

    <div class="field">
      <label>显示时区</label>
      <select v-model="timezone" class="select wide">
        <option v-for="z in commonZones" :key="z" :value="z">{{ z }}</option>
      </select>
    </div>

    <div class="result-box" v-if="fromTs">
      <div class="result-row">
        <span class="k">所选时区</span>
        <span class="v">{{ localStr }}</span>
        <button type="button" class="link" @click="copyText(localStr)">复制</button>
      </div>
      <div class="result-row">
        <span class="k">UTC ISO</span>
        <span class="v mono">{{ localIso }}</span>
        <button type="button" class="link" @click="copyText(localIso)">复制</button>
      </div>
    </div>
    <div v-else class="error-bar">请输入有效的数字时间戳</div>

    <div class="zone-table">
      <div class="zone-head">多时区对照</div>
      <div v-for="row in zoneRows" :key="row.zone" class="zone-row">
        <span class="zone">{{ row.zone }}</span>
        <span class="text">{{ row.text }}</span>
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
.now-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  padding: 10px 12px;
  background: #fff5f8;
  border-radius: 8px;
  font-size: 13px;
  color: #7a4a5e;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.field { margin-bottom: 14px; }
.field > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
  font-weight: 500;
}
.row { display: flex; gap: 8px; align-items: center; }
.input, .select {
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  box-sizing: border-box;
}
.input { flex: 1; min-width: 0; }
.select.wide { width: 100%; height: 34px; }
.btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.btn-primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn:hover { border-color: #ff7eb6; color: #ff7eb6; }
.btn-primary:hover { color: #fff; filter: brightness(1.05); }
.result-box {
  border: 1px solid #f2d7e2;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 16px;
  background: #fffafc;
}
.result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
}
.k { width: 72px; color: #909399; flex: none; }
.v { flex: 1; color: #303133; word-break: break-all; }
.mono { font-family: Consolas, monospace; }
.link {
  border: none;
  background: none;
  color: #ff7eb6;
  cursor: pointer;
  font-size: 12px;
}
.error-bar {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fef0f0;
  color: #f56c6c;
  border-radius: 6px;
  font-size: 13px;
}
.zone-table { border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
.zone-head {
  padding: 10px 12px;
  background: #fafafa;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid #eee;
}
.zone-row {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #f5f5f5;
  font-size: 13px;
}
.zone-row:last-child { border-bottom: none; }
.zone { width: 180px; color: #909399; flex: none; }
.text { color: #303133; }
@media (max-width: 900px) {
  .grid-2 { grid-template-columns: 1fr; }
  .zone { width: 120px; }
}
</style>
