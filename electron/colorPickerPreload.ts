import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('colorPickerOverlay', {
  pick: (hex: string) => ipcRenderer.send('color-picker:picked', hex),
  cancel: () => ipcRenderer.send('color-picker:cancel'),
  onInit: (callback: (payload: { dataUrl: string; scaleX: number; scaleY: number }) => void) => {
    ipcRenderer.on('color-picker:init', (_event, payload) => callback(payload))
  }
})
