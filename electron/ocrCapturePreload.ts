import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ocrCaptureOverlay', {
  confirm: (region: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('ocr-capture:confirm', region),
  cancel: () => ipcRenderer.send('ocr-capture:cancel'),
  onInit: (callback: (payload: { dataUrl: string; scaleX: number; scaleY: number }) => void) => {
    ipcRenderer.on('ocr-capture:init', (_event, payload) => callback(payload))
  }
})