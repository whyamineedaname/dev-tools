<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { ReaderLocation } from '@/types/reader'
import './reader.css'

type FoliateViewEl = HTMLElement & {
  open: (book: Blob | File | string) => Promise<unknown>
  init: (opts: { lastLocation?: string | number | { fraction: number }; showTextStart?: boolean }) => Promise<unknown>
  close?: () => void
  goTo: (target: string | number | { fraction: number }) => Promise<unknown>
  goToFraction?: (f: number) => Promise<unknown>
  goLeft?: () => Promise<unknown>
  goRight?: () => Promise<unknown>
  prev?: () => Promise<unknown>
  next?: () => Promise<unknown>
}

const props = defineProps<{
  file: File | null
  initialLocation: ReaderLocation | null
}>()

const emit = defineEmits<{
  relocate: [detail: { cfi?: string; index?: number; fraction?: number }]
  error: [message: string]
  ready: []
}>()

const hostRef = ref<HTMLElement | null>(null)
let view: FoliateViewEl | null = null
let opening = false

function onRelocate(e: Event): void {
  const detail = (e as CustomEvent).detail as {
    cfi?: string
    index?: number
    fraction?: number
  }
  emit('relocate', detail)
}

async function ensureView(): Promise<FoliateViewEl | null> {
  if (view || !hostRef.value) return view
  await import('foliate-js/view.js')
  view = document.createElement('foliate-view') as FoliateViewEl
  view.addEventListener('relocate', onRelocate)
  hostRef.value.append(view)
  return view
}

function toLastLocation(loc: ReaderLocation | null): string | number | { fraction: number } | undefined {
  if (!loc) return undefined
  if (loc.kind === 'cfi' && loc.cfi) return loc.cfi
  if (loc.kind === 'page') return loc.page
  if (loc.fraction != null) return { fraction: loc.fraction }
  return undefined
}

async function openFile(file: File, loc: ReaderLocation | null): Promise<void> {
  if (opening) return
  opening = true
  try {
    const v = await ensureView()
    if (!v) return
    v.close?.()
    await v.open(file)
    const lastLocation = toLastLocation(loc)
    if (lastLocation !== undefined) {
      await v.init({ lastLocation })
    } else {
      await v.init({ showTextStart: true })
    }
    emit('ready')
  } catch (e: unknown) {
    emit('error', e instanceof Error ? e.message : String(e))
  } finally {
    opening = false
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function onKeyDown(e: KeyboardEvent): void {
  if (!view || opening || isTypingTarget(e.target)) return
  if (e.altKey || e.ctrlKey || e.metaKey) return

  // 上下方向键留给内容区滚动，只用左右翻页
  switch (e.key) {
    case 'ArrowLeft':
    case 'h':
      e.preventDefault()
      void (view.goLeft?.() ?? view.prev?.())
      break
    case 'ArrowRight':
    case 'l':
      e.preventDefault()
      void (view.goRight?.() ?? view.next?.())
      break
    default:
      break
  }
}

watch(
  () => props.file,
  (file) => {
    if (file) void openFile(file, props.initialLocation)
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  view?.removeEventListener('relocate', onRelocate)
  view?.close?.()
  view?.remove()
  view = null
})
</script>

<template>
  <div ref="hostRef" class="foliate-host" />
</template>
