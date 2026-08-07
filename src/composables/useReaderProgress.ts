import { ref } from 'vue'
import type { ReaderLocation, ReaderProgressRecord, ReaderRecentItem } from '@/types/reader'

export function useReaderProgress() {
  const saving = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest: ReaderProgressRecord | null = null

  async function load(fileHash: string): Promise<ReaderProgressRecord | null> {
    const res = await window.electronAPI.reader.getProgress(fileHash)
    if (!res.success) throw new Error(res.error)
    return res.data
  }

  async function listRecent(limit = 10): Promise<ReaderRecentItem[]> {
    const res = await window.electronAPI.reader.listRecent(limit)
    if (!res.success) throw new Error(res.error)
    return res.data
  }

  function scheduleSave(record: ReaderProgressRecord): void {
    latest = record
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, 800)
  }

  async function flush(): Promise<void> {
    if (!latest) return
    saving.value = true
    try {
      const res = await window.electronAPI.reader.saveProgress(latest)
      if (!res.success) console.error('[reader] saveProgress', res.error)
    } finally {
      saving.value = false
    }
  }

  function dispose(): void {
    if (timer) clearTimeout(timer)
    timer = null
    void flush()
  }

  return { saving, load, listRecent, scheduleSave, flush, dispose }
}

export function locationFromRelocate(detail: {
  cfi?: string
  index?: number
  fraction?: number
}): ReaderLocation {
  if (detail.cfi) {
    return { kind: 'cfi', cfi: detail.cfi, fraction: detail.fraction }
  }
  return {
    kind: 'page',
    page: typeof detail.index === 'number' ? detail.index : 0,
    fraction: detail.fraction
  }
}
