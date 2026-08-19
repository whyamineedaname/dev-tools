<script setup lang="ts">
import { computed } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import TabBar from '@/components/TabBar.vue'
import { useTabsStore } from '@/stores/tabs'
import { tools } from '@/config/tools'
import JsonTool from '@/components/tools/JsonTool.vue'
import CryptoTool from '@/components/tools/CryptoTool.vue'
import RegexTool from '@/components/tools/RegexTool.vue'
import TimestampTool from '@/components/tools/TimestampTool.vue'
import DiffTool from '@/components/tools/DiffTool.vue'
import FormatConvertTool from '@/components/tools/FormatConvertTool.vue'
import CronTool from '@/components/tools/CronTool.vue'
import ClipboardHistoryTool from '@/components/tools/ClipboardHistoryTool.vue'
import FileToMdTool from '@/components/tools/FileToMdTool.vue'
import DocToPdfTool from '@/components/tools/DocToPdfTool.vue'
import DocReaderTool from '@/components/tools/DocReaderTool.vue'
import Mp4ToWebpTool from '@/components/tools/Mp4ToWebpTool.vue'
import MediaTranscodeTool from '@/components/tools/MediaTranscodeTool.vue'
import VoiceSeparateTool from '@/components/tools/VoiceSeparateTool.vue'
import OcrTool from '@/components/tools/OcrTool.vue'
import ColorPickerTool from '@/components/tools/ColorPickerTool.vue'
import RemoveBgTool from '@/components/tools/RemoveBgTool.vue'
import QrTool from '@/components/tools/QrTool.vue'
import ImageResizeTool from '@/components/tools/ImageResizeTool.vue'
import ExifTool from '@/components/tools/ExifTool.vue'
import PuzzleTool from '@/components/tools/PuzzleTool.vue'
import HttpClientTool from '@/components/tools/HttpClientTool.vue'
import PortTool from '@/components/tools/PortTool.vue'
import DnsTool from '@/components/tools/DnsTool.vue'
import DataSyncTool from '@/components/tools/DataSyncTool.vue'
import BiliDownloaderTool from '@/components/tools/BiliDownloaderTool.vue'
import ThemeTool from '@/components/tools/ThemeTool.vue'
import MenuTool from '@/components/tools/MenuTool.vue'
import LoanCalcTool from '@/components/tools/LoanCalcTool.vue'
import type { Component } from 'vue'

const tabsStore = useTabsStore()

const activeTool = computed(() => {
  if (!tabsStore.activeTab) return null
  return tools.find(t => t.id === tabsStore.activeTab!.toolId)
})

const toolComponents: Record<string, Component> = {
  JsonTool,
  CryptoTool,
  RegexTool,
  TimestampTool,
  DiffTool,
  FormatConvertTool,
  CronTool,
  ClipboardHistoryTool,
  FileToMdTool,
  DocToPdfTool,
  DocReaderTool,
  Mp4ToWebpTool,
  MediaTranscodeTool,
  VoiceSeparateTool,
  OcrTool,
  ColorPickerTool,
  RemoveBgTool,
  QrTool,
  ImageResizeTool,
  ExifTool,
  PuzzleTool,
  HttpClientTool,
  PortTool,
  DnsTool,
  DataSyncTool,
  BiliDownloaderTool,
  ThemeTool,
  MenuTool,
  LoanCalcTool
}
</script>

<template>
  <div class="app-container">
    <!-- 主画面背景层：position: fixed 保证切换主题时 CSS 变量变化必然触发重绘
         （body 的 background-attachment: fixed 组合变量存在不重绘的 Chromium 问题） -->
    <div class="app-bg" aria-hidden="true"></div>
    <Sidebar />
    <div class="main-content">
      <TabBar />
      <div class="tool-content">
        <component
          v-if="activeTool"
          :is="toolComponents[activeTool.component]"
          :key="tabsStore.activeTabId"
        />
        <div v-else class="empty-state">
          <p>选择左侧工具开始使用</p>
        </div>
      </div>
      <div class="right-bottom-decor" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.app-bg {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: -1;
  pointer-events: none;
  user-select: none;
  background: var(--tusi-main-bg) center/cover no-repeat;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.tool-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
  /* 半透明内容区：让主画面背景图透出，透明度由主题变量控制 */
  background: var(--tusi-content-bg);
  position: relative;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 16px;
}

.right-bottom-decor {
  position: absolute;
  right: -10px;
  bottom: -25px;
  z-index: 10;
  pointer-events: none;
  user-select: none;
  width: 200px;
  height: 300px;
  background-image: var(--tusi-right-bottom-bg);
  background-size: cover;
  background-repeat: no-repeat;
  background-position: right bottom;
  opacity: 0.9;
}

</style>
