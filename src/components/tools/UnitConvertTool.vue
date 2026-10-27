<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import { DEFAULT_CATEGORY_ID, UNIT_CATEGORIES, findCategory } from '@/config/units'
import { convertText, searchUnits } from '@/utils/unitConvert'
import type { UnitDef } from '@/types/units'

// 单位换算：左右两栏都可编辑，互为逆运算。
// 规则只有一条 —— 最后获得焦点的一侧是「锚点」，另一侧永远是锚点的格式化投影，
// 因此永远不会出现反复换算累积的精度漂移。

const SIDES = ['left', 'right'] as const
type Side = (typeof SIDES)[number]

const STORAGE_KEY = 'tusi.unitConvert.config'
const SIG_OPTIONS = [3, 4, 6, 8, 10]

// ---------- 状态 ----------
const categoryId = ref(DEFAULT_CATEGORY_ID)
const unitIds = reactive<Record<Side, string>>({ left: '', right: '' })
const texts = reactive<Record<Side, string>>({ left: '1', right: '' })
const anchor = ref<Side>('left')
const approxSide = ref<Side | null>(null)
const sig = ref(6)
const error = ref('')
const rateText = ref('')
const rateApprox = ref(false)

/** 各分类记住上次用的单位对；各分类的最近使用单位（下拉里置顶） */
const pairs = ref<Record<string, [string, string]>>({})
const recent = ref<Record<string, string[]>>({})

// ---------- 单位下拉 ----------
const openSide = ref<Side | null>(null)
const query = ref('')
const highlight = ref(0)

const category = computed(() => findCategory(categoryId.value) ?? UNIT_CATEGORIES[0])

function unitOf(side: Side): UnitDef {
  const units = category.value.units
  return units.find(u => u.id === unitIds[side]) ?? units[0]
}

const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')

/** 搜索结果；无关键字时把「最近使用」的单位排到最前，等效于置顶 */
const orderedUnits = computed(() => {
  const list = searchUnits(category.value.units, query.value)
  if (query.value.trim()) return list
  const recentIds = recent.value[category.value.id] ?? []
  const rank = (id: string) => {
    const index = recentIds.indexOf(id)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return [...list].sort((a, b) => rank(a.id) - rank(b.id))
})

const isRecent = (id: string) => (recent.value[category.value.id] ?? []).includes(id)

const rateLine = computed(() => ({
  from: unitOf('left'),
  to: unitOf('right')
}))

// ---------- 换算 ----------
function recompute(from: Side) {
  const to = other(from)
  const raw = texts[from]
  const outcome = convertText(raw, unitOf(from), unitOf(to), sig.value)

  if (outcome.ok) {
    texts[to] = outcome.text
    approxSide.value = outcome.approx ? to : null
    error.value = ''
  } else {
    texts[to] = ''
    approxSide.value = null
    error.value = raw.trim() ? outcome.error || '' : ''
  }
  rateText.value = outcome.rate
  rateApprox.value = outcome.rateApprox
}

function onInput(side: Side) {
  anchor.value = side
  recompute(side)
}

function setAnchor(side: Side) {
  anchor.value = side
}

// ---------- 单位选择 ----------
function openPicker(side: Side) {
  openSide.value = side
  query.value = ''
  highlight.value = Math.max(0, orderedUnits.value.findIndex(u => u.id === unitIds[side]))
  // 注意：模板 ref 写在 v-for 里会被 Vue 收成数组，所以这里直接按 DOM 查询聚焦
  void nextTick(() => {
    document.querySelector<HTMLInputElement>('.picker-search')?.focus()
  })
}

function closePicker() {
  openSide.value = null
  query.value = ''
}

function pickUnit(unitId: string) {
  const side = openSide.value
  if (!side) return
  unitIds[side] = unitId
  rememberUnit(category.value.id, unitId)
  rememberPair()
  closePicker()
  recompute(anchor.value)
}

function rememberUnit(catId: string, unitId: string) {
  const list = recent.value[catId] ?? []
  recent.value[catId] = [unitId, ...list.filter(id => id !== unitId)].slice(0, 4)
}

function rememberPair() {
  pairs.value[category.value.id] = [unitIds.left, unitIds.right]
}

function onPickerKeydown(event: KeyboardEvent) {
  const list = orderedUnits.value
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlight.value = Math.min(list.length - 1, highlight.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlight.value = Math.max(0, highlight.value - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const target = list[highlight.value]
    if (target) pickUnit(target.id)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closePicker()
  }
}

watch(query, () => {
  highlight.value = 0
})

// ---------- 分类与互换 ----------
function firstDifferentUnitId(excludeId: string): string {
  return category.value.units.find(u => u.id !== excludeId)?.id ?? excludeId
}

function applyCategory(id: string) {
  categoryId.value = id
  const cat = findCategory(id) ?? UNIT_CATEGORIES[0]
  const stored = pairs.value[cat.id]
  const pick = (want: string | undefined, fallback: string) =>
    want && cat.units.some(u => u.id === want) ? want : fallback

  unitIds.left = pick(stored?.[0], cat.defaults[0])
  unitIds.right = pick(stored?.[1], cat.defaults[1])
  if (unitIds.left === unitIds.right) {
    unitIds.right = firstDifferentUnitId(unitIds.left)
  }
  error.value = ''
  recompute(anchor.value)
}

function swap() {
  const leftText = texts.left
  const leftUnit = unitIds.left
  texts.left = texts.right
  texts.right = leftText
  unitIds.left = unitIds.right
  unitIds.right = leftUnit
  approxSide.value = null
  rememberPair()
  recompute(anchor.value)
}

// ---------- 配置持久化 ----------
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const cfg = JSON.parse(raw) as Record<string, unknown>
    if (typeof cfg.categoryId === 'string' && findCategory(cfg.categoryId)) {
      categoryId.value = cfg.categoryId
    }
    if (typeof cfg.sig === 'number' && SIG_OPTIONS.includes(cfg.sig)) sig.value = cfg.sig
    if (typeof cfg.anchor === 'string' && SIDES.includes(cfg.anchor as Side)) {
      anchor.value = cfg.anchor as Side
    }
    if (cfg.pairs && typeof cfg.pairs === 'object') {
      pairs.value = cfg.pairs as Record<string, [string, string]>
    }
    if (cfg.recent && typeof cfg.recent === 'object') {
      recent.value = cfg.recent as Record<string, string[]>
    }
  } catch {
    // 配置损坏时使用默认值
  }
}

function saveConfig() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        categoryId: categoryId.value,
        sig: sig.value,
        anchor: anchor.value,
        pairs: pairs.value,
        recent: recent.value
      })
    )
  } catch {
    // 存储不可用时静默失败
  }
}

// ---------- 生命周期 ----------
function onDocumentMousedown(event: MouseEvent) {
  if (!openSide.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-picker-root]')) return
  closePicker()
}

onMounted(() => {
  loadConfig()
  applyCategory(categoryId.value)
  document.addEventListener('mousedown', onDocumentMousedown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedown)
})

watch([categoryId, sig, anchor, pairs, recent], saveConfig, { deep: true })
watch(sig, () => recompute(anchor.value))
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>单位换算</h2>
      <p>左右任意一侧输入，另一侧实时互逆换算；支持分数、英尺英寸写法</p>
    </div>

    <!-- 工具条：分类下拉 + 精度 -->
    <div class="toolbar">
      <label class="field">
        <span>分类</span>
        <select
          class="select"
          :value="categoryId"
          @change="applyCategory(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="cat in UNIT_CATEGORIES" :key="cat.id" :value="cat.id">
            {{ cat.name }}（{{ cat.units.length }}）
          </option>
        </select>
      </label>

      <span class="hint">支持 <code>3/8</code>、<code>5'11"</code>、<code>1e-3</code>、<code>1,234.5</code></span>

      <label class="field right">
        <span>精度</span>
        <select v-model.number="sig" class="select">
          <option v-for="option in SIG_OPTIONS" :key="option" :value="option">
            {{ option }} 位有效
          </option>
        </select>
      </label>
    </div>

    <!-- 双栏互逆换算 -->
    <div class="converter">
      <template v-for="side in SIDES" :key="side">
        <div
          class="side"
          :class="{ 'is-anchor': anchor === side }"
          @focusin="setAnchor(side)"
        >
          <div class="value-row">
            <span v-if="approxSide === side" class="approx">≈</span>
            <input
              v-model="texts[side]"
              class="value"
              type="text"
              inputmode="decimal"
              spellcheck="false"
              autocomplete="off"
              :aria-label="side === 'left' ? '左侧数值' : '右侧数值'"
              @input="onInput(side)"
            />
          </div>

          <button
            type="button"
            class="unit-btn"
            data-picker-root
            :title="unitOf(side).note || unitOf(side).name"
            @click="openSide === side ? closePicker() : openPicker(side)"
          >
            <span class="unit-name">{{ unitOf(side).name }}</span>
            <span class="unit-symbol">{{ unitOf(side).symbol }}</span>
            <span class="chev">{{ openSide === side ? '▴' : '▾' }}</span>
          </button>

          <div v-if="openSide === side" class="picker" data-picker-root>
            <input
              v-model="query"
              class="picker-search"
              type="text"
              spellcheck="false"
              placeholder="搜索单位：lb / 磅 / pound"
              @keydown="onPickerKeydown"
            />
            <div class="picker-list">
              <button
                v-for="(unit, index) in orderedUnits"
                :key="unit.id"
                type="button"
                class="picker-item"
                :class="{ active: index === highlight, selected: unit.id === unitOf(side).id }"
                @mouseenter="highlight = index"
                @click="pickUnit(unit.id)"
              >
                <span class="p-star" :class="{ on: isRecent(unit.id) }">★</span>
                <span class="p-name">{{ unit.name }}</span>
                <span class="p-symbol">{{ unit.symbol }}</span>
                <span v-if="unit.note" class="p-note" :title="unit.note">ⓘ</span>
              </button>
              <div v-if="!orderedUnits.length" class="p-empty">没有匹配的单位</div>
            </div>
          </div>

          <!-- 页脚：锚点侧显示错误或状态，投影侧显示换算依据 -->
          <div class="side-foot">
            <template v-if="anchor === side">
              <span v-if="error" class="err">{{ error }}</span>
              <span v-else-if="unitOf(side).note" class="note">{{ unitOf(side).note }}</span>
              <span v-else class="muted">正在输入</span>
            </template>
            <template v-else>
              <span class="muted">
                1 {{ unitOf(anchor).symbol }} {{ rateApprox ? '≈' : '=' }} {{ rateText }}
                {{ unitOf(other(anchor)).symbol }}
              </span>
            </template>
          </div>
        </div>

        <button
          v-if="side === 'left'"
          type="button"
          class="swap-btn"
          title="互换两侧数值与单位"
          @click="swap"
        >
          ⇄
        </button>
      </template>
    </div>

    <div class="foot-note">
      数值全程在本机计算，不联网；单位系数采用精确定义值
      （1 in = 25.4 mm、1 lb = 453.59237 g 等）。
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  background: #fff;
  border-radius: 8px;
  padding: 16px 18px 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.head h2 { margin: 0 0 4px; font-size: 18px; color: #303133; }
.head p { margin: 0 0 14px; font-size: 13px; color: #909399; }

/* ---------- 工具条 ---------- */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.field { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #606266; }
.field.right { margin-left: auto; }
.select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
}
.select:hover { border-color: #ff7eb6; }
.hint { font-size: 12px; color: #c0c4cc; }
.hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #909399;
  font-family: Consolas, 'Courier New', monospace;
}

/* ---------- 双栏 ---------- */
.converter {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
.side {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 12px 14px 10px;
  background: #fff;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.side:focus-within { box-shadow: 0 0 0 3px rgba(255, 126, 182, 0.12); }
.side.is-anchor { border-color: #ff7eb6; background: #fffafc; }

.value-row { display: flex; align-items: baseline; gap: 4px; }
.approx { font-size: 18px; color: #909399; }
.value {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 4px 0 6px;
  font-size: 26px;
  line-height: 1.2;
  font-family: Consolas, 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: #303133;
}
.value::placeholder { color: #dcdfe6; }

.unit-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #303133;
  text-align: left;
}
.unit-btn:hover { border-color: #ff7eb6; }
.unit-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit-symbol {
  flex: 0 0 auto;
  font-family: Consolas, 'Courier New', monospace;
  color: #909399;
  font-size: 12px;
}
.chev { flex: 0 0 auto; color: #c0c4cc; font-size: 11px; }

/* ---------- 单位下拉 ---------- */
.picker {
  position: absolute;
  z-index: 5;
  left: 12px;
  right: 12px;
  top: 92px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.picker-search {
  width: 100%;
  box-sizing: border-box;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-bottom: 1px solid #eee;
  outline: none;
  font-size: 13px;
  color: #303133;
}
.picker-list { max-height: 300px; overflow: auto; padding: 4px; }
.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #303133;
  text-align: left;
}
.picker-item.active { background: #f5f7fa; }
.picker-item.selected { color: #ff7eb6; font-weight: 600; }
.p-star { flex: 0 0 auto; width: 12px; color: #e4e7ed; font-size: 11px; }
.p-star.on { color: #ffb3d1; }
.p-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-symbol {
  flex: 0 0 auto;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  color: #909399;
}
.p-note { flex: 0 0 auto; color: #c0c4cc; font-size: 12px; }
.p-empty { padding: 12px; text-align: center; font-size: 12px; color: #c0c4cc; }

/* ---------- 互换按钮 ---------- */
.swap-btn {
  align-self: center;
  width: 38px;
  height: 38px;
  border: 1px solid #dcdfe6;
  border-radius: 50%;
  background: #fff;
  color: #606266;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, transform 0.15s;
}
.swap-btn:hover { border-color: #ff7eb6; color: #ff7eb6; }
.swap-btn:active { transform: scale(0.94); }

/* ---------- 页脚 ---------- */
.side-foot {
  min-height: 18px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted { color: #c0c4cc; }
.note { color: #909399; }
.err { color: #f56c6c; }

.foot-note {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed #eee;
  font-size: 12px;
  color: #c0c4cc;
}

/* ---------- 窄屏：上下堆叠，按钮转 90° ---------- */
@media (max-width: 900px) {
  .converter { grid-template-columns: 1fr; }
  .swap-btn { justify-self: center; transform: rotate(90deg); }
  .swap-btn:active { transform: rotate(90deg) scale(0.94); }
  .value { font-size: 22px; }
  .picker { top: auto; }
  .field.right { margin-left: 0; }
  .hint { display: none; }
}
</style>
