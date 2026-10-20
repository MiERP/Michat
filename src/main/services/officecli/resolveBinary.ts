import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Resolve the officecli native binary for the current platform.
 *
 * Layout (matches the upstream release asset names):
 *   resources/officecli/<platform>-<arch>/officecli[.exe]
 *
 * The binary is a self-contained, single-file build: skills and help schemas are
 * embedded in the assembly, so nothing else needs to ship alongside it.
 */

export type PlatformKey =
  | 'win-x64'
  | 'win-arm64'
  | 'mac-x64'
  | 'mac-arm64'
  | 'linux-x64'
  | 'linux-arm64'

export function platformKey(): PlatformKey | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) return null
  if (process.platform === 'win32') return `win-${arch}` as PlatformKey
  if (process.platform === 'darwin') return `mac-${arch}` as PlatformKey
  if (process.platform === 'linux') return `linux-${arch}` as PlatformKey
  return null
}

export function binaryFileName(): string {
  return process.platform === 'win32' ? 'officecli.exe' : 'officecli'
}

function candidateRoots(): string[] {
  const roots: string[] = []
  if (process.env.MICHAT_OFFICECLI_ROOT) roots.push(process.env.MICHAT_OFFICECLI_ROOT)
  roots.push(join(process.cwd(), 'resources'))
  // out/main/services/officecli -> ../../../../resources
  roots.push(join(__dirname, '..', '..', '..', '..', 'resources'))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) roots.push(resourcesPath)
  return roots
}

/**
 * Absolute path to the vendored binary, or null when it is not shipped for this
 * platform. Callers must treat null as "office features unavailable", never as
 * a hard failure — document ingestion keeps working through the legacy loaders.
 */
export function resolveOfficeCliBinary(): string | null {
  if (process.env.MICHAT_OFFICECLI_BIN && existsSync(process.env.MICHAT_OFFICECLI_BIN)) {
    return process.env.MICHAT_OFFICECLI_BIN
  }

  const key = platformKey()
  if (!key) return null

  for (const root of candidateRoots()) {
    const candidate = join(root, 'officecli', key, binaryFileName())
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** True when the binary both exists and answers `--version` with exit code 0. */
export async function probeBinaryVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      timeout: 20000,
      windowsHide: true
    })
    const version = stdout.trim().split('\n').pop()?.trim()
    return version && version.length > 0 ? version : null
  } catch {
    return null
  }
}
