export {}

declare global {
  interface Window {
    electronAPI: {
      platform: string
      dialog: {
        openFile: (options?: {
          title?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
        openDirectory: (title?: string) => Promise<string | null>
        saveFile: (options?: {
          title?: string
          defaultPath?: string
          filters?: { name: string; extensions: string[] }[]
        }) => Promise<string | null>
      }
      file: {
        readText: (filePath: string) => Promise<{
          success: boolean
          content?: string
          error?: string
        }>
        writeBase64: (filePath: string, base64: string) => Promise<{
          success: boolean
          error?: string
        }>
        readBinary: (filePath: string) => Promise<{
          success: boolean
          base64?: string
          size?: number
          error?: string
        }>
      }
      reader: {
        getProgress: (fileHash: string) => Promise<
          | {
              success: true
              data: {
                fileHash: string
                filePath: string
                fileName: string
                location:
                  | { kind: 'cfi'; cfi: string; fraction?: number }
                  | { kind: 'page'; page: number; fraction?: number }
                updatedAt: number
              } | null
            }
          | { success: false; error: string }
        >
        saveProgress: (record: {
          fileHash: string
          filePath: string
          fileName: string
          location:
            | { kind: 'cfi'; cfi: string; fraction?: number }
            | { kind: 'page'; page: number; fraction?: number }
          updatedAt: number
        }) => Promise<{ success: true; data: void } | { success: false; error: string }>
        listRecent: (limit?: number) => Promise<
          | {
              success: true
              data: Array<{
                fileHash: string
                filePath: string
                fileName: string
                location:
                  | { kind: 'cfi'; cfi: string; fraction?: number }
                  | { kind: 'page'; page: number; fraction?: number }
                updatedAt: number
                exists: boolean
              }>
            }
          | { success: false; error: string }
        >
        getAnnotations: (fileHash: string) => Promise<
          | {
              success: true
              data: {
                fileHash: string
                inks: Array<{
                  id: string
                  page: number
                  color: string
                  width: number
                  points: Array<{ x: number; y: number }>
                  createdAt: number
                }>
                notes: Array<{
                  id: string
                  page: number
                  x: number
                  y: number
                  text: string
                  tags: string[]
                  color: string
                  createdAt: number
                  updatedAt: number
                }>
                updatedAt: number
              }
            }
          | { success: false; error: string }
        >
        saveAnnotations: (doc: {
          fileHash: string
          inks: unknown[]
          notes: unknown[]
          updatedAt: number
        }) => Promise<{ success: true; data: void } | { success: false; error: string }>
      }
      crypto: {
        generateRsaKeys: () => Promise<
          | {
              success: true
              publicKeyPem: string
              privateKeyPem: string
              publicKeyB64: string
              privateKeyB64: string
            }
          | { success: false; error: string }
        >
      }
      python: {
        fileToMd: (inputPath: string, outputPath: string) => Promise<{
          success: boolean
          output: string
          error: string
        }>
        docToPdf: (inputPath: string, outputPath: string) => Promise<{
          success: boolean
          output: string
          error: string
        }>
      }
      color: {
        pick: () => Promise<{
          success: boolean
          hex?: string
          cancelled?: boolean
          error?: string
        }>
      }
      ffmpeg: {
        check: () => Promise<{
          available: boolean
          version: string
          error: string
        }>
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
        ) => Promise<{
          success: boolean
          output: string
          error: string
        }>
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
        ) => Promise<{
          success: boolean
          output: string
          error: string
        }>
      }
      clipboardHistory: {
        list: () => Promise<{ success: true; data: Array<
          | {
              id: string
              kind: 'text'
              text: string
              preview: string
              createdAt: number
            }
          | {
              id: string
              kind: 'image'
              fileName: string
              width: number
              height: number
              byteSize: number
              createdAt: number
            }
        > }>
        clear: () => Promise<{ success: true }>
        remove: (id: string) => Promise<{ success: true }>
        writeText: (text: string) => Promise<{ success: true }>
        writeImage: (id: string) => Promise<{ success: true } | { success: false; error: string }>
        getImageDataUrl: (id: string) => Promise<
          | { success: true; dataUrl: string }
          | { success: false; error: string }
        >
        onChange: (callback: (items: Array<
          | {
              id: string
              kind: 'text'
              text: string
              preview: string
              createdAt: number
            }
          | {
              id: string
              kind: 'image'
              fileName: string
              width: number
              height: number
              byteSize: number
              createdAt: number
            }
        >) => void) => () => void
      }
      http: {
        request: (options: {
          method: string
          url: string
          headers?: Record<string, string>
          body?: string
          timeoutMs?: number
        }) => Promise<
          | {
              success: true
              status: number
              statusText: string
              headers: Record<string, string>
              body: string
              elapsedMs: number
            }
          | {
              success: false
              error: string
              elapsedMs: number
            }
        >
      }
      net: {
        listPorts: (port?: number) => Promise<
          | {
              success: true
              data: Array<{
                protocol: string
                localAddress: string
                localPort: number
                remoteAddress: string
                remotePort: number
                state: string
                pid: number
                processName: string
              }>
            }
          | { success: false; error: string }
        >
        killPid: (pid: number) => Promise<{ success: true } | { success: false; error: string }>
        dnsLookup: (hostname: string, types?: string[]) => Promise<
          | {
              success: true
              data: {
                hostname: string
                records: Array<{ type: string; value: string }>
              }
            }
          | { success: false; error: string }
        >
      }
      bili: {
        info: (input: string, cookie?: string) => Promise<
          | {
              success: true
              data: {
                bvid: string
                aid: string
                title: string
                cover: string
                owner: string
                desc: string
                duration: number
                parsedPage?: number
                pages: Array<{
                  cid: number
                  page: number
                  part: string
                  duration: number
                }>
              }
            }
          | { success: false; error: string }
        >
        streams: (payload: { bvid: string; cid: number; cookie?: string }) => Promise<
          | {
              success: true
              data: {
                videos: Array<{
                  id: number
                  baseUrl: string
                  backupUrl?: string[]
                  width: number
                  height: number
                  bandwidth: number
                  codecs?: string
                }>
                audios: Array<{
                  id: number
                  baseUrl: string
                  backupUrl?: string[]
                  bandwidth: number
                }>
                acceptQuality: number[]
              }
            }
          | { success: false; error: string }
        >
        download: (payload: {
          bvid: string
          cid: number
          videoUrl: string
          audioUrl: string
          cookie?: string
          outputPath: string
          title?: string
        }) => Promise<
          | { success: true; outputPath: string }
          | { success: false; error: string }
        >
        onProgress: (callback: (progress: {
          phase: 'downloading' | 'merging'
          received: number
          total: number
          label: string
        }) => void) => () => void
      }
      image: {
        metadata: (inputPath: string) => Promise<
          | {
              success: true
              data: {
                width: number
                height: number
                pages: number
                animated: boolean
                format: string
              }
            }
          | { success: false; error: string }
        >
        cropResize: (
          inputPath: string,
          options: {
            crop?: { x: number; y: number; width: number; height: number }
            maxWidth?: number
            quality?: number
            format?: 'jpeg' | 'png' | 'webp'
          }
        ) => Promise<
          | {
              success: true
              data: {
                base64: string
                width: number
                height: number
                byteSize: number
                animated: boolean
                format: 'jpeg' | 'png' | 'webp'
              }
            }
          | { success: false; error: string }
        >
        toIco: (inputPath: string) => Promise<
          | { success: true; base64: string }
          | { success: false; error: string }
        >
        exif: (inputPath: string) => Promise<
          | {
              success: true
              data: {
                format: string
                width: number
                height: number
                byteSize: number
                hasExif: boolean
                tags: ExifTag[]
              }
            }
          | { success: false; error: string }
        >
        clearExif: (inputPath: string) => Promise<
          | { success: true; data: { byteSize: number } }
          | { success: false; error: string }
        >
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
        }) => Promise<
          | { success: true; base64: string; width: number; height: number }
          | { success: false; error: string }
        >
      }
      theme: {
        saveImage: (name: string, base64: string) => Promise<
          | { success: true; url: string }
          | { success: false; error: string }
        >
      }
      audio: {
        separate: (payload: {
          inputPath: string
          outputDir: string
          mode: '2stem' | '4stem'
          toMp3?: boolean
        }) => Promise<
          | {
              success: true
              outputDir: string
              files: Array<{ name: string; path: string; label: string }>
            }
          | { success: false; error: string }
        >
        cancel: () => Promise<{ success: true } | { success: false; error: string }>
        onProgress: (callback: (progress: {
          stage: string
          percent: number
          message: string
        }) => void) => () => void
      }
      shell: {
        openPath: (targetPath: string) => Promise<{
          success: boolean
          error: string
        }>
      }
    }
  }

  interface ExifTag {
    key: string
    name: string
    value: string
    group: '相机' | '拍摄参数' | '时间' | '图像' | 'GPS'
  }
}
