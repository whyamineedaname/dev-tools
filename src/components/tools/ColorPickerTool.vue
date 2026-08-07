<script setup lang="ts">
import { computed, ref } from 'vue'

interface ColorFormats {
  hex: string
  rgb: string
  rgba: string
  hsl: string
}

interface HistoryItem extends ColorFormats {
  id: number
}

const picking = ref(false)
const errorMsg = ref('')
const copiedKey = ref('')
const history = ref<HistoryItem[]>([])
let historySeq = 0

const current = ref<ColorFormats>({
  hex: '#FF7EB6',
  rgb: 'rgb(255, 126, 182)',
  rgba: 'rgba(255, 126, 182, 1)',
  hsl: 'hsl(334, 100%, 75%)'
})

const canSystemPick = computed(() => typeof window !== 'undefined' && !!window.electronAPI?.color?.pick)

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '')
  const full = raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw
  const value = Number.parseInt(full, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) }
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      break
    case gn:
      h = ((bn - rn) / d + 2) / 6
      break
    default:
      h = ((rn - gn) / d + 4) / 6
      break
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  }
}

function buildFormats(hexInput: string): ColorFormats {
  const hex = `#${hexInput.replace('#', '').toUpperCase()}`
  const { r, g, b } = hexToRgb(hex)
  const { h, s, l } = rgbToHsl(r, g, b)
  return {
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    rgba: `rgba(${r}, ${g}, ${b}, 1)`,
    hsl: `hsl(${h}, ${s}%, ${l}%)`
  }
}

function applyColor(hex: string) {
  const formats = buildFormats(hex)
  current.value = formats
  history.value = [
    { id: ++historySeq, ...formats },
    ...history.value.filter((item) => item.hex !== formats.hex)
  ].slice(0, 8)
}

async function startPick() {
  errorMsg.value = ''
  if (!canSystemPick.value) {
    errorMsg.value = '系统取色仅在桌面应用内可用'
    return
  }

  picking.value = true
  try {
    // 主进程：最小化本窗口 → 截取全部显示器 → 全屏覆盖层取色（可取任意窗口）
    const result = await window.electronAPI.color.pick()
    if (result.cancelled) return
    if (!result.success || !result.hex) {
      errorMsg.value = result.error || '取色失败'
      return
    }
    applyColor(result.hex)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    errorMsg.value = `取色失败：${message}`
  } finally {
    picking.value = false
  }
}

async function copyValue(key: keyof ColorFormats, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 1600)
  } catch {
    errorMsg.value = '复制失败，请检查剪贴板权限'
  }
}

function selectHistory(item: HistoryItem) {
  current.value = {
    hex: item.hex,
    rgb: item.rgb,
    rgba: item.rgba,
    hsl: item.hsl
  }
}

const formatRows = computed(() => ([
  { key: 'hex' as const, label: 'HEX', value: current.value.hex },
  { key: 'rgb' as const, label: 'RGB', value: current.value.rgb },
  { key: 'rgba' as const, label: 'RGBA', value: current.value.rgba },
  { key: 'hsl' as const, label: 'HSL', value: current.value.hsl }
]))

const rgbParts = computed(() => {
  const { r, g, b } = hexToRgb(current.value.hex)
  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255)
  }
})
</script>

<template>
  <div class="tool-page">
    <div class="tool-card">
      <h2 class="title">取色器</h2>
      <p class="desc">点击吸管后可在屏幕任意位置取色（含其他应用窗口），自动回显并支持复制开发参数</p>

      <div class="pick-row">
        <div class="swatch" :style="{ background: current.hex }" :title="current.hex" />
        <div class="pick-actions">
          <button
            class="btn btn-primary btn-large"
            :disabled="picking"
            @click="startPick"
          >
            {{ picking ? '取色中… 点击目标或 Esc 取消' : '吸管取色' }}
          </button>
          <p v-if="!canSystemPick" class="hint warn">系统取色仅在桌面应用内可用</p>
          <p v-else class="hint">启动后会暂时最小化本窗口，可在任意 Windows 窗口上点击取色</p>
        </div>
      </div>

      <div v-if="errorMsg" class="result-bar error">{{ errorMsg }}</div>

      <div class="channels">
        <div class="channel">
          <span class="channel-label">R</span>
          <div class="channel-bar"><i :style="{ width: `${(rgbParts.r / 255) * 100}%`, background: '#f56c6c' }" /></div>
          <span class="channel-value">{{ rgbParts.r }}</span>
        </div>
        <div class="channel">
          <span class="channel-label">G</span>
          <div class="channel-bar"><i :style="{ width: `${(rgbParts.g / 255) * 100}%`, background: '#67c23a' }" /></div>
          <span class="channel-value">{{ rgbParts.g }}</span>
        </div>
        <div class="channel">
          <span class="channel-label">B</span>
          <div class="channel-bar"><i :style="{ width: `${(rgbParts.b / 255) * 100}%`, background: '#409eff' }" /></div>
          <span class="channel-value">{{ rgbParts.b }}</span>
        </div>
      </div>

      <div class="format-list">
        <div v-for="row in formatRows" :key="row.key" class="format-row">
          <span class="format-label">{{ row.label }}</span>
          <code class="format-value">{{ row.value }}</code>
          <button class="btn" @click="copyValue(row.key, row.value)">
            {{ copiedKey === row.key ? '✓ 已复制' : '复制' }}
          </button>
        </div>
      </div>

      <div v-if="history.length" class="history">
        <div class="history-title">最近取色</div>
        <div class="history-list">
          <button
            v-for="item in history"
            :key="item.id"
            class="history-item"
            :style="{ background: item.hex }"
            :title="item.hex"
            @click="selectHistory(item)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 40px;
}

.tool-card {
  width: 100%;
  max-width: 640px;
  background: #fff;
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.desc {
  color: #909399;
  font-size: 13px;
  margin-bottom: 24px;
  line-height: 1.5;
}

.pick-row {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
}

.swatch {
  width: 96px;
  height: 96px;
  border-radius: 16px;
  border: 2px solid #f0f0f0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}

.pick-actions {
  flex: 1;
  min-width: 0;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

.hint.warn {
  color: #f56c6c;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  background: #ffe8f1;
  color: #c4567a;
  transition: background 0.2s;
}

.btn:hover:not(:disabled) {
  background: #ffd6e7;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: #ff7eb6;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #ff5c9d;
}

.btn-large {
  padding: 12px 24px;
  font-size: 15px;
  width: 100%;
}

.channels {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.channel {
  display: grid;
  grid-template-columns: 20px 1fr 36px;
  gap: 10px;
  align-items: center;
}

.channel-label {
  font-size: 12px;
  color: #909399;
  font-weight: 600;
}

.channel-bar {
  height: 8px;
  background: #f5f7fa;
  border-radius: 999px;
  overflow: hidden;
}

.channel-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
}

.channel-value {
  font-size: 12px;
  color: #606266;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.format-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.format-row {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.format-label {
  font-size: 12px;
  font-weight: 600;
  color: #909399;
}

.format-value {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-bar {
  margin-bottom: 16px;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
}

.result-bar.error {
  background: #fef0f0;
  color: #f56c6c;
}

.history {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #f0f0f0;
}

.history-title {
  font-size: 13px;
  color: #909399;
  margin-bottom: 12px;
}

.history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.history-item {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #e4e7ed;
  padding: 0;
}

.history-item:hover {
  transform: scale(1.08);
}
</style>
