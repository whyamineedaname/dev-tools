<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

// ============ 类型定义 ============
type Engine = 'mysql' | 'pg' | 'es'

interface DbConfig {
  engine: Engine
  host: string
  port: number
  user: string
  password: string
  database: string
  table: string
  scheme: string // ES 专用: http/https
}

interface FieldInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

interface TaskDef {
  id: string
  name: string
  source: DbConfig
  target: DbConfig
  primaryKey: string
  updatedAt: string
}

// ============ 常量 ============
// 与 python-scripts/datasync.py 的 _COMPAT 保持一致的兼容矩阵（srcType -> 目标类型可接受列表）
const COMPAT: Record<string, string[]> = {
  int: ['int', 'decimal', 'bool'],
  decimal: ['int', 'decimal', 'bool'],
  string: ['int', 'decimal', 'string', 'date', 'datetime', 'time', 'bool', 'json', 'binary'],
  date: ['date', 'datetime'],
  datetime: ['date', 'datetime', 'time'],
  time: ['time'],
  bool: ['bool', 'int', 'decimal'],
  json: ['json', 'string'],
  binary: ['binary']
}

const engineOptions = [
  { id: 'mysql' as Engine, label: 'MySQL' },
  { id: 'pg' as Engine, label: 'PostgreSQL' },
  { id: 'es' as Engine, label: 'Elasticsearch' }
]

const STORAGE_KEY = 'tusi-dataSync-tasks'

// ============ 状态 ============
const tasks = ref<TaskDef[]>([])
const currentTaskId = ref('')
const taskName = ref('')

const source = ref<DbConfig>(defaultConfig('mysql'))
const target = ref<DbConfig>(defaultConfig('pg'))

const sourceFields = ref<FieldInfo[]>([])
const targetFields = ref<FieldInfo[]>([])
const primaryKey = ref('id')
const batchSize = ref(500)

// 映射行：{ targetField, sourceField, targetType, sourceType, matchedBy 'auto' | 'manual' | '' }
interface MappingRow {
  targetField: string
  sourceField: string
}
const mappings = ref<MappingRow[]>([])

const loadingFields = ref<'source' | 'target' | ''>('')
const syncing = ref(false)
const errorMsg = ref('')
const statusMsg = ref('')
const result = ref<{ total: number; inserted: number; updated: number; errors: string[]; seconds: number } | null>(null)

// ============ 工具函数 ============
function defaultConfig(engine: Engine): DbConfig {
  return {
    engine,
    host: engine === 'es' ? '127.0.0.1' : '127.0.0.1',
    port: engine === 'mysql' ? 3306 : engine === 'pg' ? 5432 : 9200,
    user: '',
    password: '',
    database: '',
    table: '',
    scheme: 'http'
  }
}

function cloneConfig(c: DbConfig): DbConfig {
  return { ...c }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isFieldCompatible(srcType: string, tgtType: string): boolean {
  const allowed = COMPAT[tgtType]
  return !!allowed && allowed.includes(srcType)
}

function normField(name: string): string {
  // 自动匹配时忽略大小写与下划线
  return name.toLowerCase().replace(/_/g, '')
}

function loadTasks(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    tasks.value = raw ? (JSON.parse(raw) as TaskDef[]) : []
  } catch {
    tasks.value = []
  }
}

function persistTasks(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.value))
}

// ============ 脚本任务管理 ============
function saveTask(): void {
  errorMsg.value = ''
  const name = taskName.value.trim()
  if (!name) {
    errorMsg.value = '请先输入脚本任务名称'
    return
  }
  const existing = currentTaskId.value
    ? tasks.value.find((t) => t.id === currentTaskId.value)
    : undefined
  if (existing) {
    existing.name = name
    existing.source = cloneConfig(source.value)
    existing.target = cloneConfig(target.value)
    existing.primaryKey = primaryKey.value
    existing.updatedAt = new Date().toISOString()
  } else {
    tasks.value.push({
      id: uid(),
      name,
      source: cloneConfig(source.value),
      target: cloneConfig(target.value),
      primaryKey: primaryKey.value,
      updatedAt: new Date().toISOString()
    })
    currentTaskId.value = tasks.value[tasks.value.length - 1].id
  }
  persistTasks()
  statusMsg.value = existing ? `已更新任务「${name}」` : `已保存任务「${name}」`
}

function selectTask(): void {
  errorMsg.value = ''
  statusMsg.value = ''
  result.value = null
  const task = tasks.value.find((t) => t.id === currentTaskId.value)
  if (!task) return
  taskName.value = task.name
  source.value = cloneConfig(task.source)
  target.value = cloneConfig(task.target)
  primaryKey.value = task.primaryKey || 'id'
  sourceFields.value = []
  targetFields.value = []
  mappings.value = []
  // 自动重新查询字段并匹配
  void queryBothFields()
}

function newTask(): void {
  currentTaskId.value = ''
  taskName.value = ''
  source.value = defaultConfig('mysql')
  target.value = defaultConfig('pg')
  primaryKey.value = 'id'
  sourceFields.value = []
  targetFields.value = []
  mappings.value = []
  result.value = null
  errorMsg.value = ''
  statusMsg.value = ''
}

function deleteTask(): void {
  if (!currentTaskId.value) return
  tasks.value = tasks.value.filter((t) => t.id !== currentTaskId.value)
  persistTasks()
  currentTaskId.value = ''
  newTask()
  statusMsg.value = '已删除脚本任务'
}

// ============ 字段查询 ============
function queryCfgFor(c: DbConfig): Record<string, unknown> {
  const base: Record<string, unknown> = {
    engine: c.engine,
    host: c.host,
    port: Number(c.port) || 0,
    user: c.user,
    password: c.password
  }
  if (c.engine === 'es') {
    base.scheme = c.scheme || 'http'
    base.database = c.database // 索引名
  } else {
    base.database = c.database
    base.table = c.table
  }
  return base
}

async function queryFields(side: 'source' | 'target'): Promise<boolean> {
  const cfg = side === 'source' ? source.value : target.value
  const label = side === 'source' ? '源' : '目标'
  if (!cfg.database.trim()) {
    errorMsg.value = `${label}库配置缺少 database${cfg.engine === 'es' ? '（索引名）' : '（库名）'}`
    return false
  }
  if (cfg.engine !== 'es' && !cfg.table.trim()) {
    errorMsg.value = `${label}库配置缺少表名`
    return false
  }
  loadingFields.value = side
  errorMsg.value = ''
  statusMsg.value = ''
  try {
    const res = await window.electronAPI.datasync.fields({ source: queryCfgFor(cfg) })
    if (!res.ok) {
      errorMsg.value = res.error
      return false
    }
    const fields = res.source.fields
    if (side === 'source') {
      sourceFields.value = fields
      // 源表查询成功后：以源字段为基准生成映射行（目标字段待选择）
      rebuildRowsFromSource()
    } else {
      targetFields.value = fields
    }
    if (!fields.length) {
      statusMsg.value = `${label}表/索引字段为空`
      return true
    }
    // 目标字段就绪后自动按字段名匹配
    if (side === 'target' && sourceFields.value.length) autoMatch()
    // 若目标主键为空时，尝试用目标 id 字段
    if (side === 'target' && !primaryKey.value) {
      const idField = fields.find((f) => f.name.toLowerCase() === 'id')
      if (idField) primaryKey.value = idField.name
      else {
        const pk = fields.find((f) => f.primaryKey)
        if (pk) primaryKey.value = pk.name
      }
    }
    statusMsg.value = `${label}表字段查询完成：${fields.length} 个字段`
    return true
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    errorMsg.value = `${label}库字段查询失败：${msg}`
    return false
  } finally {
    loadingFields.value = ''
  }
}

async function querySourceFields(): Promise<void> {
  await queryFields('source')
}

async function queryTargetFields(): Promise<void> {
  await queryFields('target')
}

async function queryBothFields(): Promise<void> {
  const okSrc = await queryFields('source')
  if (!okSrc) return
  await queryFields('target')
}

// ============ 字段匹配 ============
/** 以源字段为基准重建映射行（保留已填的目标字段，新增行目标字段留空） */
function rebuildRowsFromSource(): void {
  const existing = new Map(mappings.value.map((r) => [r.sourceField, r.targetField]))
  mappings.value = sourceFields.value.map((sf) => ({
    sourceField: sf.name,
    targetField: existing.get(sf.name) ?? ''
  }))
}

function autoMatch(): void {
  errorMsg.value = ''
  statusMsg.value = ''
  if (!sourceFields.value.length) {
    errorMsg.value = '请先查询源表字段'
    return
  }
  if (!targetFields.value.length) {
    errorMsg.value = '请先查询目标表字段'
    return
  }
  rebuildRowsFromSource()
  let matched = 0
  for (const row of mappings.value) {
    // 优先同名（忽略大小写/下划线），其次找首个兼容目标字段
    const hit =
      targetFields.value.find((tf) => normField(tf.name) === normField(row.sourceField)) ??
      targetFields.value.find((tf) => isFieldCompatible(typeOf('source', row.sourceField), tf.type))
    if (hit && !mappings.value.some((r) => r !== row && r.targetField === hit.name)) {
      row.targetField = hit.name
      matched++
    }
  }
  statusMsg.value = `自动匹配完成：${matched} / ${mappings.value.length} 个字段已匹配`
}

function clearMappings(): void {
  mappings.value = mappings.value.map((r) => ({ ...r, targetField: '' }))
}

function changeEngine(cfg: DbConfig, engine: Engine): void {
  const prev = cfg.engine
  cfg.engine = engine
  cfg.port = engine === 'mysql' ? 3306 : engine === 'pg' ? 5432 : 9200
  // 换引擎后源/目标字段失效
  if (prev !== engine) {
    sourceFields.value = []
    targetFields.value = []
    mappings.value = []
  }
}

// ============ 类型校验（映射行） ============
function typeOf(side: 'source' | 'target', name: string): string {
  const arr = side === 'source' ? sourceFields.value : targetFields.value
  return arr.find((f) => f.name === name)?.type ?? ''
}

function rowError(row: MappingRow): string {
  if (!row.sourceField || !row.targetField) return ''
  const st = typeOf('source', row.sourceField)
  const tt = typeOf('target', row.targetField)
  if (!st || !tt) return ''
  if (isFieldCompatible(st, tt)) return ''
  // str -> int 等不可转换类型
  return `类型不兼容：${st} → ${tt}`
}

function tgtOptionsFor(srcName: string): string[] {
  // 先按兼容类型过滤，置于顶部推荐；其余放在后面供手动选择
  const st = typeOf('source', srcName)
  const compat = targetFields.value.filter((f) => st ? isFieldCompatible(st, f.type) : true)
  const rest = targetFields.value.filter((f) => !compat.includes(f))
  return [...compat, ...rest].map((f) => f.name)
}

/** 该源字段是否已映射到某目标字段 */
function isTaken(targetName: string, exceptSource: string): boolean {
  return mappings.value.some((r) => r.targetField === targetName && r.sourceField !== exceptSource)
}

// ============ 同步执行 ============
function buildSyncConfig(): Record<string, unknown> {
  const mapped = mappings.value.filter((r) => r.sourceField && r.targetField)
  return {
    source: queryCfgFor(source.value),
    target: queryCfgFor(target.value),
    fields: mapped.map((r) => ({ sourceField: r.sourceField, targetField: r.targetField })),
    primaryKey: primaryKey.value || 'id',
    batchSize: Math.max(1, Number(batchSize.value) || 500)
  }
}

async function runSync(): Promise<void> {
  errorMsg.value = ''
  statusMsg.value = ''
  result.value = null
  if (!sourceFields.value.length || !targetFields.value.length) {
    errorMsg.value = '请先查询源、目标两边的字段'
    return
  }
  const mapped = mappings.value.filter((r) => r.sourceField && r.targetField)
  const weakRows = mappings.value
    .filter((r) => r.sourceField && r.targetField && rowError(r))
    .map((r) => `${r.sourceField} → ${r.targetField}`)
  // 检查目标字段是否重复映射
  const tgtNames = mapped.map((r) => r.targetField)
  const dupTargets = [...new Set(tgtNames.filter((n, i) => tgtNames.indexOf(n) !== i))]
  if (dupTargets.length) {
    errorMsg.value = `目标字段被重复映射：${dupTargets.join('、')}`
    return
  }
  if (!mapped.length) {
    errorMsg.value = '请至少匹配一个字段'
    return
  }
  if (!primaryKey.value.trim()) {
    errorMsg.value = '请设置目标主键字段（同步按主键 upsert）'
    return
  }
  if (weakRows.length) {
    errorMsg.value = `字段类型不兼容，无法同步：${weakRows.join('；')}`
    return
  }
  syncing.value = true
  try {
    const cfg = buildSyncConfig()
    const res = await window.electronAPI.datasync.sync(cfg)
    if (!res.ok) {
      errorMsg.value = res.error
      return
    }
    result.value = {
      total: res.total,
      inserted: res.inserted,
      updated: res.updated,
      errors: res.errors || [],
      seconds: res.seconds
    }
    statusMsg.value = `同步完成：共 ${res.total} 条，新增 ${res.inserted}，更新 ${res.updated}`
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    errorMsg.value = `同步执行失败：${msg}`
  } finally {
    syncing.value = false
  }
}

// ============ 初始化 ============
onMounted(() => {
  loadTasks()
})

// 保存前的当前任务同步显示
const currentTaskLabel = computed(() => {
  if (!currentTaskId.value) return '新建任务'
  const t = tasks.value.find((x) => x.id === currentTaskId.value)
  return t ? `任务：${t.name}` : '新建任务'
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>数据同步 🔄</h2>
      <p>MySQL / PostgreSQL / Elasticsearch 三库互转 · 按主键批量 upsert · 字段类型自动校验</p>
    </div>

    <!-- 脚本任务管理 -->
    <div class="task-bar">
      <input
        v-model="taskName"
        class="input task-name"
        type="text"
        placeholder="脚本任务名称，如：订单表同步"
        spellcheck="false"
      />
      <select v-model="currentTaskId" class="input select task-select" @change="selectTask">
        <option value="">— 新建脚本任务 —</option>
        <option v-for="t in tasks" :key="t.id" :value="t.id">{{ t.name }}</option>
      </select>
      <button type="button" class="btn primary" @click="saveTask">保存任务</button>
      <button v-if="currentTaskId" type="button" class="btn danger" @click="deleteTask">删除</button>
    </div>
    <div class="task-hint">{{ currentTaskLabel }} · 配置会连同密码保存在本机 localStorage</div>

    <!-- 源 / 目标 配置 -->
    <div class="grid2">
      <section class="cfg-block">
        <h3>📥 源（读取）</h3>
        <div class="cfg-row">
          <label>引擎</label>
          <select class="input select" :value="source.engine" @change="changeEngine(source, ($event.target as HTMLSelectElement).value as Engine)">
            <option v-for="e in engineOptions" :key="e.id" :value="e.id">{{ e.label }}</option>
          </select>
        </div>
        <template v-if="source.engine === 'es'">
          <div class="cfg-row">
            <label>协议</label>
            <select v-model="source.scheme" class="input select">
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </div>
        </template>
        <div class="cfg-row">
          <label>主机</label>
          <input v-model="source.host" class="input" type="text" placeholder="127.0.0.1" spellcheck="false" />
        </div>
        <div class="cfg-row">
          <label>端口</label>
          <input v-model.number="source.port" class="input" type="number" placeholder="3306" />
        </div>
        <div class="cfg-row">
          <label>用户</label>
          <input v-model="source.user" class="input" type="text" placeholder="root" spellcheck="false" />
        </div>
        <div class="cfg-row">
          <label>密码</label>
          <input v-model="source.password" class="input" type="password" placeholder="••••••" />
        </div>
        <div class="cfg-row">
          <label>{{ source.engine === 'es' ? '索引' : '库名' }}</label>
          <input v-model="source.database" class="input" type="text" :placeholder="source.engine === 'es' ? 'index_name' : 'db_name'" spellcheck="false" />
        </div>
        <div v-if="source.engine !== 'es'" class="cfg-row">
          <label>表名</label>
          <input v-model="source.table" class="input" type="text" placeholder="table_name" spellcheck="false" />
        </div>
        <button type="button" class="btn block" :disabled="loadingFields !== ''" @click="querySourceFields">
          {{ loadingFields === 'source' ? '查询中…' : '🔍 查询源表字段' }}
        </button>
      </section>

      <section class="cfg-block">
        <h3>📤 目标（写入）</h3>
        <div class="cfg-row">
          <label>引擎</label>
          <select class="input select" :value="target.engine" @change="changeEngine(target, ($event.target as HTMLSelectElement).value as Engine)">
            <option v-for="e in engineOptions" :key="e.id" :value="e.id">{{ e.label }}</option>
          </select>
        </div>
        <template v-if="target.engine === 'es'">
          <div class="cfg-row">
            <label>协议</label>
            <select v-model="target.scheme" class="input select">
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </div>
        </template>
        <div class="cfg-row">
          <label>主机</label>
          <input v-model="target.host" class="input" type="text" placeholder="127.0.0.1" spellcheck="false" />
        </div>
        <div class="cfg-row">
          <label>端口</label>
          <input v-model.number="target.port" class="input" type="number" placeholder="5432" />
        </div>
        <div class="cfg-row">
          <label>用户</label>
          <input v-model="target.user" class="input" type="text" placeholder="postgres" spellcheck="false" />
        </div>
        <div class="cfg-row">
          <label>密码</label>
          <input v-model="target.password" class="input" type="password" placeholder="••••••" />
        </div>
        <div class="cfg-row">
          <label>{{ target.engine === 'es' ? '索引' : '库名' }}</label>
          <input v-model="target.database" class="input" type="text" :placeholder="target.engine === 'es' ? 'index_name' : 'db_name'" spellcheck="false" />
        </div>
        <div v-if="target.engine !== 'es'" class="cfg-row">
          <label>表名</label>
          <input v-model="target.table" class="input" type="text" placeholder="table_name" spellcheck="false" />
        </div>
        <button type="button" class="btn block" :disabled="loadingFields !== ''" @click="queryTargetFields">
          {{ loadingFields === 'target' ? '查询中…' : '🔍 查询目标表字段' }}
        </button>
      </section>
    </div>

    <!-- 字段匹配 -->
    <div class="match-head">
      <h3>🔗 字段匹配</h3>
      <div class="match-ops">
        <button type="button" class="btn" @click="autoMatch">自动匹配（按字段名）</button>
        <button type="button" class="btn" @click="clearMappings">清空</button>
        <label class="pk-label">
          目标主键
          <select v-model="primaryKey" class="input select pk-select">
            <option v-for="f in targetFields" :key="f.name" :value="f.name">{{ f.name }}</option>
          </select>
        </label>
        <label class="pk-label">
          批大小
          <input v-model.number="batchSize" class="input pk-select" type="number" min="1" step="100" />
        </label>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>源字段</th>
            <th>源类型</th>
            <th>目标字段（从目标库选择）</th>
            <th>目标类型</th>
            <th>校验</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in mappings" :key="row.sourceField">
            <td class="mono">
              {{ row.sourceField }}
              <span v-if="row.targetField === primaryKey" class="pk-badge">主键</span>
            </td>
            <td><span class="type-tag">{{ typeOf('source', row.sourceField) }}</span></td>
            <td>
              <select v-model="row.targetField" class="input select tgt-select">
                <option value="">— 不映射 —</option>
                <option v-for="tf in tgtOptionsFor(row.sourceField)" :key="tf" :value="tf" :disabled="isTaken(tf, row.sourceField)">
                  {{ tf }}
                </option>
              </select>
            </td>
            <td>
              <span v-if="row.targetField" class="type-tag">{{ typeOf('target', row.targetField) }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="rowError(row)" class="badge danger">{{ rowError(row) }}</span>
              <span v-else-if="row.targetField" class="badge ok">✓</span>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!mappings.length" class="empty">
        查询源表字段后自动生成映射行，再从目标库下拉选择目标字段
      </div>
    </div>

    <!-- 执行与结果 -->
    <div v-if="errorMsg" class="error">⚠️ {{ errorMsg }}</div>
    <div v-if="statusMsg" class="info">{{ statusMsg }}</div>

    <div v-if="result" class="result-box">
      <div class="result-grid">
        <div class="stat"><b>{{ result.total }}</b><span>总条数</span></div>
        <div class="stat"><b class="green">{{ result.inserted }}</b><span>新增</span></div>
        <div class="stat"><b class="blue">{{ result.updated }}</b><span>更新</span></div>
        <div class="stat"><b>{{ result.seconds }}s</b><span>耗时</span></div>
      </div>
      <div v-if="result.errors.length" class="error small">
        <div v-for="(e, i) in result.errors" :key="i">{{ e }}</div>
      </div>
    </div>

    <div class="sync-bar">
      <button type="button" class="btn primary big" :disabled="syncing" @click="runSync">
        {{ syncing ? '同步中…' : '🚀 开始同步' }}
      </button>
      <span class="sync-tip">按目标主键 upsert：存在则更新、不存在则插入</span>
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

/* 任务栏 */
.task-bar { display: flex; gap: 8px; margin-bottom: 6px; }
.task-name { flex: 1.2; }
.task-select { flex: 1; }
.task-hint { font-size: 12px; color: #909399; margin-bottom: 12px; }

/* 配置区 */
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.cfg-block { border: 1px solid #ebeef5; border-radius: 8px; padding: 12px 14px; background: #fafbfc; }
.cfg-block h3 { margin: 0 0 10px; font-size: 14px; color: #303133; }
.cfg-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cfg-row label { width: 52px; flex-shrink: 0; font-size: 12px; color: #606266; text-align: right; }
.cfg-row .input { flex: 1; }

/* 控件 */
.input {
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  font-family: Consolas, monospace;
  outline: none;
  background: #fff;
}
.input:focus { border-color: #409eff; }
.select { cursor: pointer; }
.btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}
.btn:hover { border-color: #c0c4cc; }
.btn.primary { background: #409eff; border-color: #409eff; color: #fff; }
.btn.danger { background: #fff; border-color: #f56c6c; color: #f56c6c; }
.btn.danger:hover { background: #fef0f0; }
.btn.block { width: 100%; margin-top: 4px; background: #f5f7fa; border-color: #e4e7ed; color: #303133; }
.btn.block:hover:not(:disabled) { background: #ecf5ff; border-color: #409eff; color: #409eff; }
.btn.big { height: 38px; padding: 0 24px; font-size: 14px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* 匹配区 */
.match-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.match-head h3 { margin: 0; font-size: 14px; color: #303133; }
.match-ops { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pk-label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #606266; }
.pk-select { width: 140px; }

.table-wrap {
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: auto;
  margin-bottom: 12px;
}
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 8px 10px; border-bottom: 1px solid #f2f2f2; text-align: left; }
th { background: #fafafa; color: #606266; white-space: nowrap; }
.mono { font-family: Consolas, monospace; }
.muted { color: #c0c4cc; }
.tgt-select { width: 220px; }
.type-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: #f0f2f5;
  color: #606266;
  font-size: 12px;
  font-family: Consolas, monospace;
}
.badge { font-size: 12px; white-space: nowrap; }
.badge.ok { color: #67c23a; }
.badge.danger { color: #f56c6c; }
.pk-badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 4px;
  background: #fff5f8;
  color: #ff7eb6;
  font-size: 11px;
  font-weight: 600;
}
.pk-flag { display: none; }

.error, .info {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  white-space: pre-wrap;
}
.error { background: #fef0f0; color: #f56c6c; }
.error.small { font-size: 12px; margin-top: 8px; }
.info { background: #ecf5ff; color: #409eff; }

/* 结果 */
.result-box { border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; background: #fafbfc; }
.result-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center; }
.stat { background: #fff; border-radius: 8px; padding: 10px 6px; }
.stat b { display: block; font-size: 20px; color: #606266; }
.stat b.green { color: #67c23a; }
.stat b.blue { color: #409eff; }
.stat span { font-size: 12px; color: #909399; }

.sync-bar { display: flex; align-items: center; gap: 12px; }
.sync-tip { font-size: 12px; color: #909399; }
.empty { padding: 24px; text-align: center; color: #c0c4cc; }
</style>