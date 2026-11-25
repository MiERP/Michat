import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Compatibility mode for machines where security software blocks Electron's
 * renderer sandbox (observed with Kaspersky on Windows). The app still keeps
 * the sandbox enabled by default; only a machine that already crashed once gets
 * a marker file and relaunches with `--no-sandbox`.
 */
export const COMPAT_MARKER = 'compat-no-sandbox'

function resolveUserDataDir(explicit?: string): string {
  if (explicit) return explicit
  try {
    return app.getPath('userData')
  } catch {
    if (process.platform === 'win32' && process.env.APPDATA) {
      const appName = (() => {
        try {
          return app.getName()
        } catch {
          return 'michat'
        }
      })()
      return join(process.env.APPDATA, appName)
    }
    return join(process.cwd(), 'michat-userdata')
  }
}

export function compatMarkerPath(userDataDir?: string): string {
  return join(resolveUserDataDir(userDataDir), COMPAT_MARKER)
}

export function isCompatModeRequested(userDataDir?: string): boolean {
  try {
    return existsSync(compatMarkerPath(userDataDir))
  } catch {
    return false
  }
}

export function requestCompatMode(userDataDir?: string): boolean {
  try {
    const marker = compatMarkerPath(userDataDir)
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, new Date().toISOString(), 'utf8')
    return true
  } catch {
    return false
  }
}

export function clearCompatMode(userDataDir?: string): boolean {
  try {
    const marker = compatMarkerPath(userDataDir)
    if (existsSync(marker)) rmSync(marker, { force: true })
    return true
  } catch {
    return false
  }
}

export interface CompatFallbackInput {
  reason: string
  windowShown: boolean
  alreadyCompat: boolean
  noSandboxSwitch: boolean
}

/**
 * Only the first pre-paint renderer failure on a sandboxed machine is allowed
 * to trigger the automatic relaunch. A second failure (or a user-supplied
 * `--no-sandbox`) must never create a relaunch loop.
 */
export function shouldAttemptCompatFallback(input: CompatFallbackInput): boolean {
  if (input.windowShown || input.alreadyCompat || input.noSandboxSwitch) return false
  return ['crashed', 'launch-failed', 'killed', 'abnormal-exit'].includes(input.reason)
}

export function shouldReportRendererExit(reason: string): boolean {
  return reason !== 'clean-exit'
}

/** Keep the original app arguments while removing any sandbox override. */
export function buildRelaunchArgs(argv: string[]): string[] {
  return argv.slice(1).filter((arg) => arg !== '--no-sandbox' && !arg.startsWith('--no-sandbox='))
}

let compatSwitchApplied = false

/**
 * Must run before `app.whenReady()` so Chromium sees the switch during startup.
 * Returns true when compatibility mode is active.
 */
export function applyCompatMode(userDataDir?: string): boolean {
  if (!isCompatModeRequested(userDataDir)) return false
  if (!compatSwitchApplied) {
    app.commandLine.appendSwitch('no-sandbox')
    compatSwitchApplied = true
  }
  return true
}
