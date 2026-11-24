/**
 * Platform detection utilities
 * Uses the main process's process.platform instead of the deprecated navigator.platform
 */

// Cache platform info to avoid repeated IPC calls
let cachedPlatform: string | null = null

/**
 * Get platform info asynchronously (recommended)
 * Fetch accurate platform info from the main process and cache it
 */
export async function getPlatform(): Promise<string> {
  if (cachedPlatform) return cachedPlatform
  cachedPlatform = await window.api.getPlatform()
  return cachedPlatform
}

/**
 * Get platform info synchronously
 * Uses userAgentData (modern standard) or the cached value
 * Falls back to navigator.platform when neither is available
 */
export function getPlatformSync(): 'darwin' | 'win32' | 'linux' | 'unknown' {
  // Prefer the cached value
  if (cachedPlatform) {
    return cachedPlatform as 'darwin' | 'win32' | 'linux' | 'unknown'
  }

  // Use userAgentData (modern standard, Chromium 90+)
  const ua = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  if (ua?.platform) {
    const platform = ua.platform.toLowerCase()
    if (platform.includes('mac')) return 'darwin'
    if (platform.includes('win')) return 'win32'
    if (platform.includes('linux')) return 'linux'
  }

  // Last resort: legacy navigator.platform (for compatibility)
  const p = navigator.platform.toUpperCase()
  if (p.includes('MAC')) return 'darwin'
  if (p.includes('WIN')) return 'win32'
  if (p.includes('LINUX')) return 'linux'

  return 'unknown'
}

/**
 * Whether the platform is macOS
 */
export const isMac = (): boolean => getPlatformSync() === 'darwin'

/**
 * Whether the platform is Windows
 */
export const isWindows = (): boolean => getPlatformSync() === 'win32'

/**
 * Whether the platform is Linux
 */
export const isLinux = (): boolean => getPlatformSync() === 'linux'

/**
 * Initialize platform detection
 * Call at app startup to preload platform info into the cache
 */
export async function initPlatform(): Promise<void> {
  await getPlatform()
}
