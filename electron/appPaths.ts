import { app, ipcMain } from 'electron'
import { isAbsolute, join, resolve } from 'path'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'

interface AppPathsConfig {
  tempDir?: string
}

export interface AppPathsState {
  tempDir: string | null
  resolvedTempDir: string
  systemTempDir: string
  userDataDir: string
  isCustom: boolean
  fallback: boolean
  fallbackReason: string
}

const CONFIG_NAME = 'app-paths.json'

let cache: AppPathsConfig | null = null

function configFile(): string {
  return join(app.getPath('userData'), CONFIG_NAME)
}

function loadConfig(): AppPathsConfig {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(configFile(), 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const tempDir = (parsed as { tempDir?: unknown }).tempDir
      cache = {
        tempDir: typeof tempDir === 'string' && tempDir.trim() ? tempDir.trim() : undefined
      }
    } else {
      cache = {}
    }
  } catch {
    cache = {}
  }
  return cache
}

function saveConfig(cfg: AppPathsConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8')
  cache = { ...cfg }
}

function ensureWritableDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const probe = join(dir, `.tusi-write-test-${process.pid}`)
  writeFileSync(probe, 'ok')
  unlinkSync(probe)
}

function normalizeDir(dir: string): string {
  const trimmed = dir.trim()
  if (!trimmed) throw new Error('请选择目录')
  const resolved = resolve(trimmed)
  if (!isAbsolute(resolved)) throw new Error('请选择绝对路径')
  return resolved
}

/** 用户自定义的临时目录（未设置则为 null，不校验是否可写） */
export function getCustomTempDir(): string | null {
  return loadConfig().tempDir || null
}

/** 系统临时目录（通常在用户盘 / C 盘） */
export function getSystemTempDir(): string {
  return app.getPath('temp')
}

/**
 * 实际用于落临时文件的目录。
 * 自定义目录不可用时回退系统临时目录，不修改已保存的设置。
 */
export function getAppTempDir(): string {
  const custom = getCustomTempDir()
  if (!custom) return getSystemTempDir()
  try {
    mkdirSync(custom, { recursive: true })
    return custom
  } catch {
    return getSystemTempDir()
  }
}

/** 保存/选目录对话框的默认起点：仅在设置了自定义目录时生效 */
export function getDialogDefaultDir(): string | undefined {
  const custom = getCustomTempDir()
  if (!custom) return undefined
  try {
    if (existsSync(custom)) return custom
  } catch {
    return undefined
  }
  return undefined
}

export function describeAppPaths(): AppPathsState {
  const systemTempDir = getSystemTempDir()
  const userDataDir = app.getPath('userData')
  const custom = getCustomTempDir()
  let resolvedTempDir = systemTempDir
  let fallback = false
  let fallbackReason = ''
  if (custom) {
    try {
      ensureWritableDir(custom)
      resolvedTempDir = custom
    } catch (err) {
      fallback = true
      fallbackReason = err instanceof Error ? err.message : String(err)
    }
  }
  return {
    tempDir: custom,
    resolvedTempDir,
    systemTempDir,
    userDataDir,
    isCustom: Boolean(custom),
    fallback,
    fallbackReason
  }
}

export function setTempDir(dir: string): AppPathsState {
  const resolved = normalizeDir(dir)
  ensureWritableDir(resolved)
  saveConfig({ ...loadConfig(), tempDir: resolved })
  return describeAppPaths()
}

export function resetTempDir(): AppPathsState {
  const cfg = { ...loadConfig() }
  delete cfg.tempDir
  saveConfig(cfg)
  return describeAppPaths()
}

export function registerAppPathsIpc(): void {
  ipcMain.handle('appPaths:get', () => describeAppPaths())

  ipcMain.handle('appPaths:setTempDir', (_event, dir: unknown) => {
    try {
      return { success: true as const, ...setTempDir(String(dir ?? '')) }
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : String(err),
        ...describeAppPaths()
      }
    }
  })

  ipcMain.handle('appPaths:resetTempDir', () => {
    return { success: true as const, ...resetTempDir() }
  })
}
