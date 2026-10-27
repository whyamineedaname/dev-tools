<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const OUTPUT_KEY = 'tusi:music-output-dir'
const SOURCES_KEY = 'tusi:music-sources'
const DEFAULT_SOURCE_IDS = ['KuwoMusicClient', 'KugouMusicClient']

interface SourceItem {
  id: string
  name: string
}

const DEFAULT_SOURCES: SourceItem[] = [
  { id: 'KuwoMusicClient', name: '酷我音乐' },
  { id: 'KugouMusicClient', name: '酷狗音乐' },
  { id: 'NeteaseMusicClient', name: '网易云音乐' },
  { id: 'QQMusicClient', name: 'QQ音乐' },
  { id: 'MiguMusicClient', name: '咪咕音乐' },
  { id: 'QianqianMusicClient', name: '千千音乐' },
  { id: 'SodaMusicClient', name: '汽水音乐' },
  { id: 'FiveSingMusicClient', name: '5sing' },
  { id: 'AppleMusicClient', name: '苹果音乐' },
  { id: 'SpotifyMusicClient', name: 'Spotify' },
  { id: 'SoundCloudMusicClient', name: 'SoundCloud' },
  { id: 'QobuzMusicClient', name: 'Qobuz' },
  { id: 'TIDALMusicClient', name: 'TIDAL' },
  { id: 'JooxMusicClient', name: 'Joox' },
  { id: 'JamendoMusicClient', name: 'Jamendo' },
  { id: 'DeezerMusicClient', name: 'Deezer' },
  { id: 'StreetVoiceMusicClient', name: 'StreetVoice' }
]

interface SongRow {
  id: string
  selected: boolean
  song: MusicDownloadSong
}

const keyword = ref('')
const cookie = ref('')
const mode = ref<'song' | 'playlist'>('song')
const limit = ref(10)
const outputDir = ref('')
const sources = ref<SourceItem[]>([...DEFAULT_SOURCES])
const selectedSources = ref<string[]>([...DEFAULT_SOURCE_IDS])
const rows = ref<SongRow[]>([])
const musicdlOk = ref<boolean | null>(null)
const envError = ref('')
const msg = ref('')
const msgType = ref<'ok' | 'err'>('ok')
const searching = ref(false)
const downloading = ref(false)
const progress = ref({ message: '', current: 0, total: 0, percent: 0 })

let unsubscribe: (() => void) | null = null

const selectedCount = computed(() => rows.value.filter((r) => r.selected).length)
const allSelected = computed(() => rows.value.length > 0 && selectedCount.value === rows.value.length)

function setMsg(text: string, type: 'ok' | 'err') {
  msg.value = text
  msgType.value = type
}

/** Electron IPC 无法克隆 Vue Proxy，发出去前先打成纯 JSON。 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function persistSources() {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(selectedSources.value))
  } catch {
    // ignore
  }
}

function persistOutputDir() {
  try {
    if (outputDir.value) localStorage.setItem(OUTPUT_KEY, outputDir.value)
  } catch {
    // ignore
  }
}

function toggleSource(id: string) {
  if (selectedSources.value.includes(id)) {
    selectedSources.value = selectedSources.value.filter((s) => s !== id)
  } else {
    selectedSources.value = [...selectedSources.value, id]
  }
  persistSources()
}

function toggleAll() {
  const next = !allSelected.value
  rows.value = rows.value.map((r) => ({ ...r, selected: next }))
}

function toggleRow(row: SongRow) {
  row.selected = !row.selected
}

async function pickOutputDir() {
  const dir = await window.electronAPI.dialog.openDirectory('选择音乐保存目录')
  if (!dir) return
  outputDir.value = dir
  persistOutputDir()
}

async function openOutputDir() {
  if (!outputDir.value) return
  const res = await window.electronAPI.shell.openPath(outputDir.value)
  if (!res.success) setMsg(res.error || '无法打开目录', 'err')
}

async function probe() {
  const res = await window.electronAPI.music.probe()
  musicdlOk.value = res.musicdlOk
  envError.value = res.error || ''
  if (res.sources?.length) sources.value = res.sources
  if (!outputDir.value && res.defaultOutputDir) {
    outputDir.value = res.defaultOutputDir
  }
}

async function search() {
  const q = keyword.value.trim()
  if (!q) {
    setMsg(mode.value === 'playlist' ? '请输入歌单链接' : '请输入搜索关键词', 'err')
    return
  }
  if (selectedSources.value.length === 0) {
    setMsg('请至少选择一个音乐来源', 'err')
    return
  }
  searching.value = true
  msg.value = ''
  rows.value = []
  try {
    const res = await window.electronAPI.music.search(toPlain({
      keyword: q,
      sources: [...selectedSources.value],
      limit: Number(limit.value) || 10,
      mode: mode.value,
      cookie: cookie.value.trim()
    }))
    if (!res.success) {
      setMsg(res.error, 'err')
      return
    }
    rows.value = res.songs.map((song, index) => ({
      id: `${index}-${song.source || ''}-${song.identifier || ''}-${song.song_name}`,
      selected: false,
      song: toPlain(song)
    }))
    setMsg(`找到 ${res.count} 首`, 'ok')
  } catch (e: unknown) {
    setMsg(e instanceof Error ? e.message : String(e), 'err')
  } finally {
    searching.value = false
  }
}

async function downloadSelected() {
  const songs = rows.value.filter((r) => r.selected).map((r) => r.song)
  if (songs.length === 0) {
    setMsg('请先勾选要下载的歌曲', 'err')
    return
  }
  if (!outputDir.value) {
    setMsg('请选择保存目录', 'err')
    return
  }
  downloading.value = true
  progress.value = { message: '准备下载…', current: 0, total: songs.length, percent: 0 }
  msg.value = ''
  try {
    const res = await window.electronAPI.music.download(toPlain({
      songs,
      outputDir: outputDir.value,
      sources: [...selectedSources.value],
      limit: Number(limit.value) || 10,
      cookie: cookie.value.trim()
    }))
    if (!res.success) {
      setMsg(res.error, 'err')
      return
    }
    const extra = res.errors.length ? `；失败 ${res.errors.length} 首` : ''
    setMsg(`已保存 ${res.count} 首到 ${res.outputDir}${extra}`, res.count > 0 ? 'ok' : 'err')
    if (res.errors.length && res.count === 0) {
      setMsg(res.errors[0], 'err')
    }
    progress.value = {
      message: '完成',
      current: res.count,
      total: songs.length,
      percent: 100
    }
  } catch (e: unknown) {
    setMsg(e instanceof Error ? e.message : String(e), 'err')
  } finally {
    downloading.value = false
  }
}

async function cancelTask() {
  await window.electronAPI.music.cancel()
}

onMounted(async () => {
  try {
    const savedDir = localStorage.getItem(OUTPUT_KEY)
    if (savedDir) outputDir.value = savedDir
    const savedSources = localStorage.getItem(SOURCES_KEY)
    if (savedSources) {
      const parsed = JSON.parse(savedSources) as unknown
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        selectedSources.value = parsed
      }
    }
  } catch {
    // ignore
  }
  await probe()
})

unsubscribe = window.electronAPI.music.onProgress((p) => {
  const percent = p.total > 0 ? Math.min(100, Math.round((p.current / p.total) * 100)) : 0
  progress.value = {
    message: p.message,
    current: p.current,
    total: p.total,
    percent
  }
})

onBeforeUnmount(() => {
  unsubscribe?.()
  if (searching.value || downloading.value) void cancelTask()
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>音乐下载</h2>
      <p>集成 musicdl（MrsEWE44/musicDownload），搜索网易云 / QQ / 酷狗 / 酷我 / 咪咕等平台并下载。仅供个人学习使用，请尊重版权。</p>
    </div>

    <div v-if="musicdlOk === false" class="msg err">
      {{ envError || '未安装 musicdl，请先执行：pip install musicdl' }}
    </div>

    <div class="section">
      <div class="section-title">音乐来源</div>
      <div class="source-list">
        <label
          v-for="src in sources"
          :key="src.id"
          class="source-item"
          :class="{ active: selectedSources.includes(src.id) }"
        >
          <input
            type="checkbox"
            :checked="selectedSources.includes(src.id)"
            @change="toggleSource(src.id)"
          />
          {{ src.name }}
        </label>
      </div>
    </div>

    <div class="opt-row">
      <label class="opt">
        单源数量
        <input v-model.number="limit" class="num-input" type="number" min="1" max="50" />
      </label>
      <label class="opt grow">
        保存目录
        <input class="path-input" :value="outputDir" readonly placeholder="选择保存目录" />
      </label>
      <button type="button" class="btn" @click="pickOutputDir">选择</button>
      <button type="button" class="btn" :disabled="!outputDir" @click="openOutputDir">打开</button>
    </div>

    <div class="query-row">
      <select v-model="mode" class="mode-select">
        <option value="song">搜索歌曲</option>
        <option value="playlist">解析歌单链接</option>
      </select>
      <input
        v-model="keyword"
        class="url-input"
        :placeholder="mode === 'playlist' ? '粘贴歌单链接，例如网易云 playlist?id=…' : '输入歌名 / 歌手'"
        @keyup.enter="search"
      />
      <button type="button" class="btn btn-primary" :disabled="searching || downloading" @click="search">
        {{ searching ? '搜索中…' : '搜索' }}
      </button>
    </div>

    <div class="cookie-row">
      <label class="inline">
        Cookie（可选，部分平台登录后可提升音质）
        <input v-model="cookie" class="cookie-input" type="password" placeholder="选填" />
      </label>
    </div>

    <div v-if="msg" class="msg" :class="msgType">{{ msg }}</div>

    <div v-if="rows.length" class="batch-row">
      <label class="check-all">
        <input type="checkbox" :checked="allSelected" @change="toggleAll" />
        全选（已选 {{ selectedCount }} / {{ rows.length }}）
      </label>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="downloading || selectedCount === 0"
        @click="downloadSelected"
      >
        {{ downloading ? '下载中…' : `下载选中（${selectedCount}）` }}
      </button>
      <button v-if="downloading || searching" type="button" class="btn" @click="cancelTask">取消</button>
    </div>

    <div v-if="downloading" class="progress-wrap">
      <div class="progress-label">{{ progress.message }} {{ progress.percent }}%</div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${progress.percent}%` }" />
      </div>
    </div>

    <div v-if="rows.length" class="table-wrap">
      <table class="song-table">
        <thead>
          <tr>
            <th class="col-check"></th>
            <th>歌曲</th>
            <th>歌手</th>
            <th>专辑</th>
            <th>格式</th>
            <th>大小</th>
            <th>时长</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :class="{ selected: row.selected }"
            @click="toggleRow(row)"
          >
            <td class="col-check" @click.stop>
              <input type="checkbox" :checked="row.selected" @change="toggleRow(row)" />
            </td>
            <td class="col-name">
              <img v-if="row.song.cover" class="cover" :src="row.song.cover" alt="" />
              <span>{{ row.song.song_name }}</span>
            </td>
            <td>{{ row.song.singersText }}</td>
            <td>{{ row.song.album }}</td>
            <td>{{ row.song.ext }}</td>
            <td>{{ row.song.file_size }}</td>
            <td>{{ row.song.duration }}</td>
            <td>{{ row.song.sourceLabel }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!searching" class="empty">
      选择音乐源后输入关键词搜索，或切换到「解析歌单链接」批量下载
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
.head p { margin: 0 0 14px; font-size: 13px; color: #909399; line-height: 1.5; }
.section { margin-bottom: 12px; }
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.source-item {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
  background: #fff;
}
.source-item.active {
  border-color: #ff7eb6;
  background: #fff0f5;
  color: #c4567a;
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
  flex-shrink: 0;
}
.opt.grow { flex: 1; min-width: 0; }
.num-input {
  width: 64px;
  height: 30px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
}
.path-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12px;
  color: #4a2a3a;
}
.query-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.mode-select {
  height: 36px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 13px;
  color: #606266;
  background: #fff;
}
.url-input {
  flex: 1;
  height: 36px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
}
.cookie-row { margin-bottom: 10px; }
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #909399;
}
.cookie-input {
  flex: 1;
  height: 30px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12px;
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
.btn:hover:not(:disabled) { border-color: #ff7eb6; color: #ff7eb6; }
.btn-primary:hover { color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.msg.ok { background: #f0f9eb; color: #67c23a; }
.msg.err { background: #fef0f0; color: #f56c6c; }
.batch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.check-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
}
.progress-wrap { margin-bottom: 10px; }
.progress-label { font-size: 12px; color: #606266; margin-bottom: 6px; }
.progress-bar {
  height: 8px;
  background: #f0f2f5;
  border-radius: 999px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #ff7eb6;
  border-radius: 999px;
  transition: width 0.2s;
}
.table-wrap {
  overflow: auto;
  border: 1px solid #eef0f3;
  border-radius: 8px;
}
.song-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: #606266;
}
.song-table th {
  text-align: left;
  background: #fafafa;
  color: #909399;
  font-weight: 600;
  padding: 8px;
  position: sticky;
  top: 0;
}
.song-table td {
  padding: 8px;
  border-top: 1px solid #f3f4f6;
  vertical-align: middle;
}
.song-table tr { cursor: pointer; }
.song-table tr:hover { background: #fff8fb; }
.song-table tr.selected { background: #fff0f5; }
.col-check { width: 36px; text-align: center; }
.col-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #303133;
  max-width: 280px;
}
.cover {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  flex: none;
  background: #f5f5f5;
}
.empty {
  padding: 48px 16px;
  text-align: center;
  color: #c0c4cc;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
}
</style>
