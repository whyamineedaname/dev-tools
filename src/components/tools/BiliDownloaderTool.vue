<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

interface BiliPage {
  cid: number
  page: number
  part: string
  duration: number
}

interface VideoStream {
  id: number
  baseUrl: string
  backupUrl?: string[]
  width: number
  height: number
  bandwidth: number
  codecs?: string
}

interface AudioStream {
  id: number
  baseUrl: string
  backupUrl?: string[]
  bandwidth: number
}

const input = ref('')
const cookie = ref('')
const msg = ref('')
const msgType = ref<'ok' | 'err'>('ok')
const loading = ref(false)

const info = ref<{
  bvid: string
  aid: string
  title: string
  cover: string
  owner: string
  desc: string
  duration: number
  pages: BiliPage[]
} | null>(null)

const selectedPage = ref<BiliPage | null>(null)
const streams = ref<{ videos: VideoStream[]; audios: AudioStream[] } | null>(null)
const selectedVideo = ref<VideoStream | null>(null)
const selectedAudio = ref<AudioStream | null>(null)

const downloading = ref(false)
const progress = ref({ phase: '', received: 0, total: 0, label: '', percent: 0 })

let unsubscribe: (() => void) | null = null

function fmtDuration(sec: number): string {
  if (!sec) return '--:--'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function fmtSpeed(bandwidth: number): string {
  const mbps = bandwidth / 1024 / 1024
  return mbps >= 1 ? `${mbps.toFixed(1)} Mbps` : `${Math.round(bandwidth / 1024)} Kbps`
}

function qualityLabel(v: VideoStream): string {
  const h = v.height
  if (h >= 2160) return '4K'
  if (h >= 1440) return '2K'
  if (h >= 1080) return '1080P'
  if (h >= 720) return '720P'
  if (h >= 480) return '480P'
  if (h >= 360) return '360P'
  return `${h}P`
}

async function queryInfo() {
  if (!input.value.trim()) {
    setMsg('请输入视频地址或 BV/av 号', 'err')
    return
  }
  loading.value = true
  msg.value = ''
  info.value = null
  streams.value = null
  selectedPage.value = null
  try {
    const result = await window.electronAPI.bili.info(input.value.trim(), cookie.value.trim() || undefined)
    if (!result.success) {
      setMsg(result.error, 'err')
      return
    }
    info.value = result.data
    // 默认选中解析到的分P
    const target = result.data.pages.find((p) => p.page === (result.data.parsedPage || 1))
    selectedPage.value = target || result.data.pages[0] || null
    if (selectedPage.value) await queryStreams(selectedPage.value)
    setMsg(`查询成功：${result.data.title}`, 'ok')
  } catch (e: unknown) {
    setMsg(e instanceof Error ? e.message : String(e), 'err')
  } finally {
    loading.value = false
  }
}

async function queryStreams(page: BiliPage) {
  if (!info.value) return
  streams.value = null
  selectedVideo.value = null
  selectedAudio.value = null
  const result = await window.electronAPI.bili.streams({
    bvid: info.value.bvid,
    cid: page.cid,
    cookie: cookie.value.trim() || undefined
  })
  if (!result.success) {
    setMsg(result.error, 'err')
    return
  }
  streams.value = result.data
  // 默认选最高带宽
  selectedVideo.value =
    result.data.videos.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a), result.data.videos[0]) || null
  selectedAudio.value =
    result.data.audios.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a), result.data.audios[0]) || null
}

function selectPage(page: BiliPage) {
  selectedPage.value = page
  void queryStreams(page)
}

async function startDownload() {
  if (!info.value || !selectedPage.value || !selectedVideo.value || !selectedAudio.value) {
    setMsg('请先查询并选择分P与清晰度', 'err')
    return
  }
  const defaultName = `${info.value.title}-P${selectedPage.value.page}`
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 80)
  const outputPath = await window.electronAPI.dialog.saveFile({
    title: '保存视频',
    defaultPath: `${defaultName}.mp4`,
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
  })
  if (!outputPath) return

  downloading.value = true
  msg.value = ''
  progress.value = { phase: 'downloading', received: 0, total: 0, label: '准备下载…', percent: 0 }
  try {
    const result = await window.electronAPI.bili.download({
      bvid: info.value.bvid,
      cid: selectedPage.value.cid,
      videoUrl: selectedVideo.value.baseUrl,
      audioUrl: selectedAudio.value.baseUrl,
      cookie: cookie.value.trim() || undefined,
      outputPath,
      title: info.value.title
    })
    if (!result.success) {
      setMsg(result.error, 'err')
      return
    }
    progress.value = { phase: 'done', received: 0, total: 0, label: '完成', percent: 100 }
    setMsg(`下载完成：${result.outputPath}`, 'ok')
  } catch (e: unknown) {
    setMsg(e instanceof Error ? e.message : String(e), 'err')
  } finally {
    downloading.value = false
  }
}

function setMsg(text: string, type: 'ok' | 'err') {
  msg.value = text
  msgType.value = type
}

onBeforeUnmount(() => {
  unsubscribe?.()
})

// 订阅下载进度
unsubscribe = window.electronAPI.bili.onProgress((p) => {
  const percent = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0
  progress.value = {
    phase: p.phase,
    received: p.received,
    total: p.total,
    label: p.label,
    percent
  }
})
</script>

<template>
  <div class="tool-card">
    <div class="head">
      <h2>B 站视频下载器</h2>
      <p>输入视频地址 / BV 号 / av 号，查询后选择清晰度下载（音视频由 ffmpeg 无损合并）</p>
    </div>

    <div class="query-row">
      <input
        v-model="input"
        class="url-input"
        placeholder="例如：BV1xx411c7mD 或 https://www.bilibili.com/video/BV1xx411c7mD?p=2"
        @keyup.enter="queryInfo"
      />
      <button type="button" class="btn btn-primary" :disabled="loading" @click="queryInfo">
        {{ loading ? '查询中…' : '查询信息' }}
      </button>
    </div>

    <div class="cookie-row">
      <label class="inline">
        Cookie（可选，登录后提升清晰度，如 SESSDATA=xxx）
        <input v-model="cookie" class="cookie-input" type="password" placeholder="选填：SESSDATA=..." />
      </label>
    </div>

    <div v-if="msg" class="msg" :class="msgType">{{ msg }}</div>

    <template v-if="info">
      <div class="video-card">
        <img v-if="info.cover" class="cover" :src="info.cover" alt="" />
        <div class="video-meta">
          <div class="title">{{ info.title }}</div>
          <div class="sub">UP主：{{ info.owner }} · 时长 {{ fmtDuration(info.duration) }}</div>
          <div v-if="info.desc" class="desc">{{ info.desc }}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">分P选择（{{ info.pages.length }}）</div>
        <div class="page-list">
          <button
            v-for="page in info.pages"
            :key="page.cid"
            type="button"
            class="page-btn"
            :class="{ active: selectedPage?.cid === page.cid }"
            @click="selectPage(page)"
          >
            <span class="page-no">P{{ page.page }}</span>
            <span class="page-part">{{ page.part || `P${page.page}` }}</span>
            <span class="page-dur">{{ fmtDuration(page.duration) }}</span>
          </button>
        </div>
      </div>

      <template v-if="streams">
        <div class="section">
          <div class="section-title">清晰度选择</div>
          <div class="stream-list">
            <button
              v-for="v in streams.videos"
              :key="v.id"
              type="button"
              class="stream-btn"
              :class="{ active: selectedVideo?.id === v.id }"
              @click="selectedVideo = v"
            >
              <span class="stream-q">{{ qualityLabel(v) }}</span>
              <span class="stream-dim">{{ v.width }}×{{ v.height }}</span>
              <span class="stream-bw">{{ fmtSpeed(v.bandwidth) }}</span>
              <span v-if="v.codecs" class="stream-codec">{{ (v.codecs || '').split('.')[0] }}</span>
            </button>
          </div>
          <div class="audio-info">
            音频：{{ selectedAudio ? fmtSpeed(selectedAudio.bandwidth) : '—' }}
          </div>
        </div>

        <div class="download-row">
          <button
            type="button"
            class="btn btn-primary btn-lg"
            :disabled="downloading"
            @click="startDownload"
          >
            {{ downloading ? '下载中…' : '下载视频' }}
          </button>
        </div>
      </template>

      <div v-if="downloading" class="progress-wrap">
        <div class="progress-label">{{ progress.label }} {{ progress.percent }}%</div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progress.percent}%` }" />
        </div>
      </div>
    </template>

    <div v-if="!info && !loading" class="empty">
      粘贴 B 站视频链接、BV 号或 av 号，点击「查询信息」查看视频详情
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
.query-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
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
.btn-lg { height: 38px; padding: 0 20px; font-size: 14px; }
.msg {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.msg.ok { background: #f0f9eb; color: #67c23a; }
.msg.err { background: #fef0f0; color: #f56c6c; }
.empty {
  padding: 48px 16px;
  text-align: center;
  color: #c0c4cc;
  border: 1px dashed #e4e7ed;
  border-radius: 8px;
}
.video-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border: 1px solid #eee;
  border-radius: 8px;
  margin-bottom: 12px;
}
.cover {
  width: 120px;
  height: 75px;
  object-fit: cover;
  border-radius: 6px;
  flex: none;
}
.video-meta { min-width: 0; }
.title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}
.sub { font-size: 12px; color: #909399; margin-bottom: 4px; }
.desc {
  font-size: 12px;
  color: #606266;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.section { margin-bottom: 12px; }
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.page-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.page-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
  max-width: 260px;
}
.page-btn.active {
  border-color: #ff7eb6;
  background: #fff0f5;
  color: #c4567a;
}
.page-no { flex: none; font-weight: 600; }
.page-part {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-dur { flex: none; color: #909399; }
.stream-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.stream-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
}
.stream-btn.active {
  border-color: #ff7eb6;
  background: #fff0f5;
  color: #c4567a;
}
.stream-q { font-weight: 600; }
.stream-dim, .stream-codec { color: #909399; }
.stream-bw { color: #67c23a; }
.audio-info { margin-top: 8px; font-size: 12px; color: #909399; }
.download-row { margin-top: 14px; }
.progress-wrap { margin-top: 12px; }
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
</style>
