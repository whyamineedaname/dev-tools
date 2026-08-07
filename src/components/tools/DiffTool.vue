<script setup lang="ts">
import { computed, ref } from 'vue'
import { diffLines, type Change } from 'diff'

const left = ref('苹果\n香蕉\n橙子\n西瓜')
const right = ref('苹果\n草莓\n橙子\n哈密瓜')
const ignoreWhitespace = ref(false)

const changes = computed<Change[]>(() =>
  diffLines(left.value, right.value, {
    ignoreWhitespace: ignoreWhitespace.value
  })
)

const stats = computed(() => {
  let added = 0
  let removed = 0
  for (const c of changes.value) {
    const n = c.count ?? c.value.split('\n').filter((l, i, arr) => l !== '' || i < arr.length - 1).length
    if (c.added) added += n
    if (c.removed) removed += n
  }
  return { added, removed }
})

function lineClass(c: Change): string {
  if (c.added) return 'add'
  if (c.removed) return 'del'
  return 'same'
}

function prefix(c: Change): string {
  if (c.added) return '+'
  if (c.removed) return '-'
  return ' '
}

function swap() {
  const t = left.value
  left.value = right.value
  right.value = t
}

function clearAll() {
  left.value = ''
  right.value = ''
}
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>文本对比</h2>
      <p>左右粘贴文本，按行高亮新增 / 删除差异</p>
    </div>

    <div class="toolbar">
      <label class="flag">
        <input v-model="ignoreWhitespace" type="checkbox" />
        忽略空白差异
      </label>
      <button type="button" class="btn" @click="swap">左右交换</button>
      <button type="button" class="btn" @click="clearAll">清空</button>
      <span class="stats">+{{ stats.added }} / -{{ stats.removed }}</span>
    </div>

    <div class="editors">
      <div class="col">
        <label>原文（左）</label>
        <textarea v-model="left" class="textarea" rows="12" spellcheck="false" />
      </div>
      <div class="col">
        <label>对比（右）</label>
        <textarea v-model="right" class="textarea" rows="12" spellcheck="false" />
      </div>
    </div>

    <div class="diff-view">
      <div class="diff-title">差异结果</div>
      <pre class="diff-body"><template v-for="(c, i) in changes" :key="i"><span
        v-for="(line, j) in c.value.replace(/\n$/, '').split('\n')"
        :key="`${i}-${j}`"
        class="line"
        :class="lineClass(c)"
      >{{ prefix(c) }} {{ line }}
</span></template></pre>
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
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.flag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
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
.btn:hover { border-color: #ff7eb6; color: #ff7eb6; }
.stats {
  margin-left: auto;
  font-size: 13px;
  color: #909399;
  font-family: Consolas, monospace;
}
.editors {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.col label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 180px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: Consolas, 'Courier New', monospace;
  resize: vertical;
}
.diff-view {
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
}
.diff-title {
  padding: 10px 12px;
  background: #fafafa;
  border-bottom: 1px solid #eee;
  font-size: 13px;
  font-weight: 600;
}
.diff-body {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  padding: 8px 0;
  font-size: 12px;
  font-family: Consolas, 'Courier New', monospace;
  line-height: 1.55;
}
.line {
  display: block;
  padding: 0 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.line.add { background: #f0f9eb; color: #67c23a; }
.line.del { background: #fef0f0; color: #f56c6c; }
.line.same { color: #606266; }
@media (max-width: 900px) {
  .editors { grid-template-columns: 1fr; }
}
</style>
