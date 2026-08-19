import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  dialog: {
    openFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('dialog:openFile', options),
    openDirectory: (title?: string) =>
      ipcRenderer.invoke('dialog:openDirectory', title),
    openFiles: (options?: {
      title?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:openFiles', options),
    saveFile: (options?: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:saveFile', options)
  },
  file: {
    readText: (filePath: string) =>
      ipcRenderer.invoke('file:readText', filePath),
    writeBase64: (filePath: string, base64: string) =>
      ipcRenderer.invoke('file:writeBase64', filePath, base64),
    readBinary: (filePath: string) =>
      ipcRenderer.invoke('file:readBinary', filePath)
  },
  reader: {
    getProgress: (fileHash: string) =>
      ipcRenderer.invoke('reader:getProgress', fileHash),
    saveProgress: (record: {
      fileHash: string
      filePath: string
      fileName: string
      location:
        | { kind: 'cfi'; cfi: string; fraction?: number }
        | { kind: 'page'; page: number; fraction?: number }
      updatedAt: number
    }) => ipcRenderer.invoke('reader:saveProgress', record),
    listRecent: (limit?: number) =>
      ipcRenderer.invoke('reader:listRecent', limit),
    getAnnotations: (fileHash: string) =>
      ipcRenderer.invoke('reader:getAnnotations', fileHash),
    saveAnnotations: (doc: {
      fileHash: string
      inks: unknown[]
      notes: unknown[]
      updatedAt: number
    }) => ipcRenderer.invoke('reader:saveAnnotations', doc)
  },
  crypto: {
    generateRsaKeys: () =>
      ipcRenderer.invoke('crypto:generateRsaKeys')
  },
  python: {
    fileToMd: (inputPath: string, outputPath: string) =>
      ipcRenderer.invoke('python:fileToMd', inputPath, outputPath),
    docToPdf: (inputPath: string, outputPath: string) =>
      ipcRenderer.invoke('python:docToPdf', inputPath, outputPath)
  },
  ocr: {
    captureRegion: () => ipcRenderer.invoke('ocr:captureRegion'),
    fromDataUrl: (subcommand: 'image' | 'qrcode', dataUrl: string) =>
      ipcRenderer.invoke('ocr:fromDataUrl', subcommand, dataUrl),
    image: (imagePath: string) =>
      ipcRenderer.invoke('python:ocrImage', imagePath),
    batch: (paths: string[]) =>
      ipcRenderer.invoke('python:ocrBatch', paths),
    pdf: (pdfPath: string) =>
      ipcRenderer.invoke('python:ocrPdf', pdfPath),
    qrcode: (imagePath: string) =>
      ipcRenderer.invoke('python:ocrQrcode', imagePath)
  },
  color: {
    pick: () => ipcRenderer.invoke('color:pick')
  },
  ffmpeg: {
    check: () => ipcRenderer.invoke('ffmpeg:check'),
    mp4ToWebp: (
      inputPath: string,
      outputPath: string,
      options?: {
        fps?: number
        maxWidth?: number
        quality?: number
        startSec?: number
        durationSec?: number
      }
    ) => ipcRenderer.invoke('ffmpeg:mp4ToWebp', inputPath, outputPath, options),
    transcode: (
      inputPath: string,
      outputPath: string,
      options: {
        mode: 'toMp3' | 'extractAudio' | 'compressVideo'
        audioBitrate?: string
        audioCodec?: 'mp3' | 'aac' | 'wav' | 'copy'
        videoCrf?: number
        maxWidth?: number
        startSec?: number
        durationSec?: number
      }
    ) => ipcRenderer.invoke('ffmpeg:transcode', inputPath, outputPath, options)
  },
  clipboardHistory: {
    list: () => ipcRenderer.invoke('clipboard:list'),
    clear: () => ipcRenderer.invoke('clipboard:clear'),
    remove: (id: string) => ipcRenderer.invoke('clipboard:remove', id),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    writeImage: (id: string) => ipcRenderer.invoke('clipboard:writeImage', id),
    getImageDataUrl: (id: string) => ipcRenderer.invoke('clipboard:getImageDataUrl', id),
    onChange: (callback: (items: unknown[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, items: unknown[]) => callback(items)
      ipcRenderer.on('clipboard:changed', listener)
      return () => ipcRenderer.removeListener('clipboard:changed', listener)
    }
  },
  http: {
    request: (options: {
      method: string
      url: string
      headers?: Record<string, string>
      body?: string
      timeoutMs?: number
    }) => ipcRenderer.invoke('http:request', options)
  },
  net: {
    listPorts: (port?: number) => ipcRenderer.invoke('net:listPorts', port),
    killPid: (pid: number) => ipcRenderer.invoke('net:killPid', pid),
    dnsLookup: async (hostname: string, types?: string[]) => {
      // 兜底：即使 invoke 序列化失败也返回可读错误，避免渲染层抛 “An object could not be cloned”
      try {
        return await ipcRenderer.invoke('net:dnsLookup', hostname, types)
      } catch (e: unknown) {
        const name = e instanceof Error ? `${e.name}: ` : ''
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[preload] dnsLookup failed:', e)
        return { success: false, error: `DNS 调用失败：${name}${msg}` }
      }
    }
  },
  datasync: {
    fields: (cfg: unknown) => ipcRenderer.invoke('datasync:fields', cfg),
    sync: (cfg: unknown) => ipcRenderer.invoke('datasync:sync', cfg)
  },
  bili: {
    info: (input: string, cookie?: string) =>
      ipcRenderer.invoke('bili:info', input, cookie),
    streams: (payload: { bvid: string; cid: number; cookie?: string }) =>
      ipcRenderer.invoke('bili:streams', payload),
    download: (payload: {
      bvid: string
      cid: number
      videoUrl: string
      audioUrl: string
      cookie?: string
      outputPath: string
      title?: string
    }) => ipcRenderer.invoke('bili:download', payload),
    onProgress: (callback: (progress: {
      phase: 'downloading' | 'merging'
      received: number
      total: number
      label: string
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: {
        phase: 'downloading' | 'merging'
        received: number
        total: number
        label: string
      }) => callback(progress)
      ipcRenderer.on('bili:progress', listener)
      return () => ipcRenderer.removeListener('bili:progress', listener)
    }
  },
  image: {
    metadata: (inputPath: string) =>
      ipcRenderer.invoke('image:metadata', inputPath),
    cropResize: (
      inputPath: string,
      options: {
        crop?: { x: number; y: number; width: number; height: number }
        maxWidth?: number
        quality?: number
        format?: 'jpeg' | 'png' | 'webp'
      }
    ) => ipcRenderer.invoke('image:cropResize', inputPath, options),
    toIco: (inputPath: string) =>
      ipcRenderer.invoke('image:toIco', inputPath),
    exif: (inputPath: string) =>
      ipcRenderer.invoke('image:exif', inputPath),
    clearExif: (inputPath: string) =>
      ipcRenderer.invoke('image:clearExif', inputPath),
    puzzle: (payload: {
      mode: 'grid' | 'hstack' | 'vstack' | 'free'
      paths?: string[]
      items?: { path: string; x: number; y: number; width: number; height: number }[]
      gap?: number
      background?: string
      cols?: number
      rows?: number
      cellSize?: number
      canvasWidth?: number
      canvasHeight?: number
    }) => ipcRenderer.invoke('image:puzzle', payload)
  },
  theme: {
    // 保存主题背景图（原样保存，保留 webp 动图），返回 tusi-img:// 协议 URL
    saveImage: (name: string, base64: string) =>
      ipcRenderer.invoke('theme:saveImage', { name, base64 })
  },
  audio: {
    separate: (payload: {
      inputPath: string
      outputDir: string
      mode: '2stem' | '4stem'
      toMp3?: boolean
    }) => ipcRenderer.invoke('audio:separate', payload),
    cancel: () => ipcRenderer.invoke('audio:cancel'),
    onProgress: (callback: (progress: {
      stage: string
      percent: number
      message: string
    }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: {
        stage: string
        percent: number
        message: string
      }) => callback(progress)
      ipcRenderer.on('audio:progress', listener)
      return () => ipcRenderer.removeListener('audio:progress', listener)
    }
  },
  shell: {
    openPath: (targetPath: string) =>
      ipcRenderer.invoke('shell:openPath', targetPath)
  }
})
