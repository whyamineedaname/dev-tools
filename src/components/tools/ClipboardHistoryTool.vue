<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

type HistoryItem =
  | {
      id: string
      kind: 'text'
      text: string
      preview: string
      createdAt: number
    }
  | {
      id: string
      kind: 'image'
      fileName: string
      width: number
      height: number
      byteSize: number
      createdAt: number
    }

const items = ref<HistoryItem[]>([])
const imageUrls = ref<Record<string, string>>({})
const msg = ref('')
const filter = ref<'all' | 'text' | 'image'>('all')
let unsubscribe: (() => void) | null = null

const visibleItems = computed(() =>
  items.value.filter((i) => filter.value === 'all' || i.kind === filter.value)
)

async function refresh() {
  const result = await window.electronAPI.clipboardHistory.list()
  if (!result.success) return
  items.value = result.data
  await loadMissingImages()
}

async function loadMissingImages() {
  for (const item of items.value) {
    if (item.kind !== 'image' || imageUrls.value[item.id]) continue
    const res = await window.electronAPI.clipboardHistory.getImageDataUrl(item.id)
    if (res.success) imageUrls.value[item.id] = res.dataUrl
  }
}

async function copyBack(item: HistoryItem) {
  msg.value = ''
  if (item.kind === 'text') {
    await window.electronAPI.clipboardHistory.writeText(item.text)
    msg.value = '已写回剪贴板（文本）'
  } else {
    const res = await window.electronAPI.clipboardHistory.writeImage(item.id)
    msg.value = res.success ? '已写回剪贴板（图片）' : res.error
  }
}

async function removeItem(id: string) {
  await window.electronAPI.clipboardHistory.remove(id)
  delete imageUrls.value[id]
  await refresh()
}

async function clearAll() {
  await window.electronAPI.clipboardHistory.clear()
  imageUrls.value = {}
  await refresh()
  msg.value = '已清空历史'
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

onMounted(async () => {
  await refresh()
  unsubscribe = window.electronAPI.clipboardHistory.onChange((next) => {
    items.value = next
    void loadMissingImages()
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>剪贴板历史</h2>
      <p>自动记录最近复制的文本与图片，可一键写回剪贴板</p>
    </div>

    <div class="toolbar">
      <button
        v-for="f in ([
          ['all', '全部'],
          ['text', '文本'],
          ['image', '图片']
        ] as const)"
        :key="f[0]"
        type="button"
        class="btn"
        :class="{ active: filter === f[0] }"
        @click="filter = f[0]"
      >
        {{ f[1] }}
      </button>
      <button type="button" class="btn" @click="refresh">刷新</button>
      <button type="button" class="btn danger" @click="clearAll">清空</button>
    </div>

    <div v-if="msg" class="msg">{{ msg }}</div>
    <div v-if="!visibleItems.length" class="empty">暂无记录。去别处复制一段文字或图片后再回来。</div>

    <div class="list">
      <div v-for="item in visibleItems" :key="item.id" class="item">
        <template v-if="item.kind === 'text'">
          <div class="badge">文本</div>
          <div class="body">
            <div class="preview">{{ item.preview }}</div>
            <div class="meta">{{ fmtTime(item.createdAt) }} · {{ item.text.length }} 字</div>
          </div>
        </template>
        <template v-else>
          <img class="thumb" :src="imageUrls[item.id] || ''" alt="" />
          <div class="body">
            <div class="preview">图片 {{ item.width }}×{{ item.height }}</div>
            <div class="meta">{{ fmtTime(item.createdAt) }} · {{ fmtSize(item.byteSize) }}</div>
          </div>
        </template>
        <div class="actions">
          <button type="button" class="btn primary" @click="copyBack(item)">写回</button>
          <button type="button" class="btn" @click="removeItem(item.id)">删除</button>
        </div>
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
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn.active, .btn.primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn.danger { color: #f56c6c; border-color: #f5c2c2; }
.btn:hover { border-color: #ff7eb6; color: #ff7eb6; }
.btn.active:hover, .btn.primary:hover { color: #fff; }
.msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #f0f9eb;
  color: #67c23a;
  border-radius: 6px;
  font-size: 13px;
}
.empty {
  padding: 40px 12px;
  text-align: center;
  color: #c0c4cc;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
}
.list { display: flex; flex-direction: column; gap: 10px; }
.item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 8px;
}
.badge {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #fff0f5;
  color: #c4567a;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}
.thumb {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 8px;
  background: #f5f7fa;
  flex: none;
}
.body { flex: 1; min-width: 0; }
.preview {
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta { margin-top: 4px; font-size: 12px; color: #909399; }
.actions { display: flex; gap: 6px; flex: none; }
</style>
