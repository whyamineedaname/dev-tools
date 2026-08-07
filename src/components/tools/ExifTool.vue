<script setup lang="ts">
import { computed, ref } from 'vue'

interface ExifData {
  format: string
  width: number
  height: number
  byteSize: number
  hasExif: boolean
  tags: ExifTag[]
}

const GROUP_ORDER: ExifTag['group'][] = ['相机', '拍摄参数', '时间', '图像', 'GPS']

const path = ref('')
const data = ref<ExifData | null>(null)
const msg = ref('')
const clearing = ref(false)

const groupedTags = computed(() =>
  GROUP_ORDER.map((group) => ({
    group,
    tags: (data.value?.tags || []).filter((t) => t.group === group)
  })).filter((s) => s.tags.length)
)

const fileSizeText = computed(() =>
  data.value ? fmtSize(data.value.byteSize) : ''
)

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function loadFromPath(filePath: string) {
  msg.value = ''
  const result = await window.electronAPI.image.exif(filePath)
  if (!result.success) {
    data.value = null
    path.value = ''
    msg.value = result.error
    return
  }
  path.value = filePath
  data.value = result.data
  msg.value = result.data.hasExif
    ? `已读取 ${result.data.tags.length} 条 EXIF 信息`
    : '该图片不包含 EXIF 信息'
}

async function pickImage() {
  const filePath = await window.electronAPI.dialog.openFile({
    title: '选择图片',
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff']
      }
    ]
  })
  if (!filePath) return
  try {
    await loadFromPath(filePath)
  } catch (e: unknown) {
    msg.value = e instanceof Error ? e.message : String(e)
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const file = Array.from(e.dataTransfer?.files || [])[0]
  if (!file) return
  const withPath = file as File & { path?: string }
  if (withPath.path) {
    void loadFromPath(withPath.path).catch((err: unknown) => {
      msg.value = err instanceof Error ? err.message : String(err)
    })
  } else {
    msg.value = '无法读取该文件路径，请改用「选择图片」按钮'
  }
}

async function clearExif() {
  if (!path.value || !data.value?.hasExif || clearing.value) return
  if (!window.confirm('将重新编码图片并覆盖原文件，确认清除 EXIF 信息？')) return
  clearing.value = true
  msg.value = ''
  try {
    const result = await window.electronAPI.image.clearExif(path.value)
    if (!result.success) {
      msg.value = result.error
      return
    }
    await loadFromPath(path.value)
    msg.value = `已清除 EXIF 信息，新文件大小 ${fmtSize(result.data.byteSize)}`
  } finally {
    clearing.value = false
  }
}

function reset() {
  path.value = ''
  data.value = null
  msg.value = ''
}
</script>

<template>
  <div class="tool-card" @dragover.prevent @drop="onDrop">
    <div class="head">
      <h2>📷 EXIF 信息查看 / 清除</h2>
      <p>读取相机型号、拍摄参数、拍摄时间与 GPS 等元数据；清除后原文件将被重新编码覆盖</p>
    </div>

    <div class="toolbar">
      <button type="button" class="btn btn-primary" @click="pickImage">选择图片</button>
      <button
        v-if="data && data.hasExif"
        type="button"
        class="btn btn-danger"
        :disabled="clearing"
        @click="clearExif"
      >
        {{ clearing ? '清除中…' : '清除 EXIF 信息' }}
      </button>
      <button v-if="data" type="button" class="btn" @click="reset">重新选择</button>
    </div>

    <div v-if="msg" class="msg">{{ msg }}</div>
    <div v-if="!data" class="empty">拖拽图片到此处，或点击上方选择图片</div>

    <template v-if="data">
      <div class="summary">
        <div class="summary-item">
          <span class="label">格式</span>
          <span class="value">{{ data.format.toUpperCase() }}</span>
        </div>
        <div class="summary-item">
          <span class="label">尺寸</span>
          <span class="value">{{ data.width }} × {{ data.height }}</span>
        </div>
        <div class="summary-item">
          <span class="label">大小</span>
          <span class="value">{{ fileSizeText }}</span>
        </div>
        <div class="summary-item">
          <span class="label">EXIF</span>
          <span class="value" :class="data.hasExif ? 'has-exif' : 'no-exif'">
            {{ data.hasExif ? `含 ${data.tags.length} 条信息` : '无' }}
          </span>
        </div>
      </div>

      <div v-if="data.hasExif" class="exif-groups">
        <div v-for="section in groupedTags" :key="section.group" class="group">
          <div class="group-title">{{ section.group }}</div>
          <table class="tag-table">
            <tbody>
              <tr v-for="tag in section.tags" :key="tag.key">
                <td class="tag-name">{{ tag.name }}</td>
                <td class="tag-value">{{ tag.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
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
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-primary { background: #ff7eb6; border-color: #ff7eb6; color: #fff; }
.btn-danger { background: #f56c6c; border-color: #f56c6c; color: #fff; }
.btn:hover:not(:disabled) { border-color: #ff7eb6; color: #ff7eb6; }
.btn-primary:hover:not(:disabled), .btn-danger:hover:not(:disabled) { color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: #f0f9eb;
  color: #67c23a;
  border-radius: 6px;
  font-size: 13px;
}
.empty {
  padding: 48px 16px;
  text-align: center;
  color: #c0c4cc;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 14px 0;
  padding: 12px 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fafafa;
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.summary-item .label {
  font-size: 11px;
  color: #909399;
}
.summary-item .value {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  font-family: Consolas, monospace;
}
.value.has-exif { color: #409eff; }
.value.no-exif { color: #909399; }

.exif-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.group-title {
  margin-bottom: 6px;
  padding-left: 8px;
  border-left: 3px solid #409eff;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.tag-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.tag-table tr:nth-child(even) {
  background: #f7f8fa;
}
.tag-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #f0f2f5;
  vertical-align: top;
}
.tag-name {
  width: 130px;
  color: #606266;
  white-space: nowrap;
}
.tag-value {
  color: #303133;
  word-break: break-all;
  font-family: Consolas, monospace;
}
</style>
