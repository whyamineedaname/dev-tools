<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CronExpressionParser } from 'cron-parser'

const expression = ref('0 9 * * 1-5')
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
const count = ref(10)
const errorMsg = ref('')
const nextTimes = ref<string[]>([])
const description = ref('')

const presets = [
  { label: '每分钟', value: '* * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '工作日 9:00', value: '0 9 * * 1-5' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每月 1 号 0:00', value: '0 0 1 * *' },
  { label: '每 5 分钟', value: '*/5 * * * *' },
  { label: '每 2 小时', value: '0 */2 * * *' }
]

const fieldsHint = '分 时 日 月 周（可选秒在最前）'

function parseCron() {
  errorMsg.value = ''
  nextTimes.value = []
  description.value = ''
  try {
    const expr = expression.value.trim()
    if (!expr) {
      errorMsg.value = '请输入 Cron 表达式'
      return
    }
    const interval = CronExpressionParser.parse(expr, {
      currentDate: new Date(),
      tz: timezone.value
    })
    const list: string[] = []
    const n = Math.min(30, Math.max(1, Math.floor(count.value) || 10))
    count.value = n
    for (let i = 0; i < n; i++) {
      const d = interval.next().toDate()
      list.push(
        new Intl.DateTimeFormat('zh-CN', {
          timeZone: timezone.value,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(d)
      )
    }
    nextTimes.value = list
    description.value = `时区 ${timezone.value} · 接下来 ${n} 次执行`
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  }
}

function applyPreset(value: string) {
  expression.value = value
  parseCron()
}

async function copyFirst() {
  if (!nextTimes.value[0]) return
  await navigator.clipboard.writeText(nextTimes.value[0])
}

watch([expression, timezone, count], () => parseCron(), { immediate: true })

const hasResult = computed(() => nextTimes.value.length > 0)
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>Cron 表达式解析</h2>
      <p>输入表达式，查看接下来多次执行时间（{{ fieldsHint }}）</p>
    </div>

    <div class="field">
      <label>表达式</label>
      <input v-model="expression" class="input" type="text" spellcheck="false" placeholder="0 9 * * 1-5" />
    </div>

    <div class="presets">
      <button
        v-for="p in presets"
        :key="p.value"
        type="button"
        class="chip"
        @click="applyPreset(p.value)"
      >
        {{ p.label }}
      </button>
    </div>

    <div class="row">
      <label class="inline">
        时区
        <select v-model="timezone" class="select">
          <option value="Asia/Shanghai">Asia/Shanghai</option>
          <option value="Asia/Tokyo">Asia/Tokyo</option>
          <option value="UTC">UTC</option>
          <option value="America/New_York">America/New_York</option>
          <option value="Europe/London">Europe/London</option>
        </select>
      </label>
      <label class="inline">
        条数
        <input v-model.number="count" class="num" type="number" min="1" max="30" />
      </label>
      <button type="button" class="btn primary" @click="parseCron">解析</button>
      <button type="button" class="btn" :disabled="!hasResult" @click="copyFirst">复制下次时间</button>
    </div>

    <div v-if="errorMsg" class="error">⚠️ {{ errorMsg }}</div>
    <div v-else-if="description" class="desc">{{ description }}</div>

    <ol v-if="hasResult" class="times">
      <li v-for="(t, i) in nextTimes" :key="i">
        <span class="idx">#{{ i + 1 }}</span>
        <span>{{ t }}</span>
      </li>
    </ol>
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
.field { margin-bottom: 10px; }
.field > label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.input {
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 12px;
  font-size: 14px;
  font-family: Consolas, monospace;
}
.presets { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid #f2d7e2;
  background: #fff5f8;
  color: #c4567a;
  cursor: pointer;
  font-size: 12px;
}
.chip:hover { border-color: #ff7eb6; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}
.select, .num, .btn {
  height: 32px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
}
.select { padding: 0 8px; }
.num { width: 72px; padding: 0 8px; }
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
.desc { margin-bottom: 10px; font-size: 13px; color: #67c23a; }
.times {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}
.times li {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #f5f5f5;
  font-size: 13px;
  font-family: Consolas, monospace;
}
.times li:last-child { border-bottom: none; }
.idx { color: #ff7eb6; width: 36px; flex: none; }
</style>
