export interface TtsVoice {
  id: string
  name: string
  transcript: string
  note: string
  durationMs: number
  createdAt: number
  updatedAt: number
  missingFile?: boolean
}
