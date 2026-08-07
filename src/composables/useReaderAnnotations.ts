import { ref } from 'vue'
import type {
  InkStroke,
  PageNote,
  ReaderAnnotationDoc,
  RelPoint
} from '@/types/reader'

function uid(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function useReaderAnnotations() {
  const fileHash = ref('')
  const inks = ref<InkStroke[]>([])
  const notes = ref<PageNote[]>([])
  const dirty = ref(false)
  const saving = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function load(hash: string): Promise<void> {
    fileHash.value = hash
    inks.value = []
    notes.value = []
    dirty.value = false
    if (!hash) return
    const res = await window.electronAPI.reader.getAnnotations(hash)
    if (!res.success) throw new Error(res.error)
    inks.value = res.data.inks ?? []
    notes.value = res.data.notes ?? []
  }

  function scheduleSave(): void {
    if (!fileHash.value) return
    dirty.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void flush()
    }, 600)
  }

  async function flush(): Promise<void> {
    if (!fileHash.value || !dirty.value) return
    saving.value = true
    try {
      const doc: ReaderAnnotationDoc = {
        fileHash: fileHash.value,
        // 展开为普通数组：Vue ref 数组是响应式 Proxy，直接传给 contextBridge 会报 “An object could not be cloned”
        inks: [...inks.value],
        notes: [...notes.value],
        updatedAt: Date.now()
      }
      const res = await window.electronAPI.reader.saveAnnotations(doc)
      if (!res.success) {
        console.error('[reader] saveAnnotations', res.error)
        return
      }
      dirty.value = false
    } finally {
      saving.value = false
    }
  }

  function addStroke(input: {
    page: number
    color: string
    width: number
    points: RelPoint[]
  }): InkStroke {
    const stroke: InkStroke = {
      id: uid(),
      page: input.page,
      color: input.color,
      width: input.width,
      points: input.points,
      createdAt: Date.now()
    }
    inks.value = [...inks.value, stroke]
    scheduleSave()
    return stroke
  }

  function removeStroke(id: string): void {
    inks.value = inks.value.filter((s) => s.id !== id)
    scheduleSave()
  }

  function clearPageInks(page: number): void {
    inks.value = inks.value.filter((s) => s.page !== page)
    scheduleSave()
  }

  function addNote(input: {
    page: number
    x: number
    y: number
    text: string
    tags: string[]
    color: string
  }): PageNote {
    const now = Date.now()
    const note: PageNote = {
      id: uid(),
      page: input.page,
      x: input.x,
      y: input.y,
      text: input.text,
      tags: input.tags,
      color: input.color,
      createdAt: now,
      updatedAt: now
    }
    notes.value = [...notes.value, note]
    scheduleSave()
    return note
  }

  function updateNote(
    id: string,
    patch: Partial<Pick<PageNote, 'text' | 'tags' | 'color' | 'x' | 'y'>>
  ): void {
    notes.value = notes.value.map((n) =>
      n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n
    )
    scheduleSave()
  }

  function removeNote(id: string): void {
    notes.value = notes.value.filter((n) => n.id !== id)
    scheduleSave()
  }

  function pageInks(page: number): InkStroke[] {
    return inks.value.filter((s) => s.page === page)
  }

  function pageNotes(page: number): PageNote[] {
    return notes.value.filter((n) => n.page === page)
  }

  async function dispose(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    await flush()
    fileHash.value = ''
    inks.value = []
    notes.value = []
  }

  return {
    fileHash,
    inks,
    notes,
    dirty,
    saving,
    load,
    flush,
    addStroke,
    removeStroke,
    clearPageInks,
    addNote,
    updateNote,
    removeNote,
    pageInks,
    pageNotes,
    dispose
  }
}
