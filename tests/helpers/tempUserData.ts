import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export interface CloseAndRemoveOptions {
  /** Injected for tests; defaults to fs.rm. */
  rm?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>
  retries?: number
  delayMs?: number
}

const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'])

/**
 * Create an isolated userData directory for a database-backed test.
 * The prefix makes leftover directories identifiable on Windows.
 */
export async function createTempUserData(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`))
}

/**
 * Close the database before removing its directory. Windows keeps SQLite WAL/SHM
 * files locked briefly after close, so rm is retried with linear backoff.
 */
export async function closeAndRemove(
  userDataDir: string,
  closeDatabase: () => void,
  options: CloseAndRemoveOptions = {}
): Promise<void> {
  const remove = options.rm ?? ((path, opts) => rm(path, opts))
  const retries = options.retries ?? 10
  const delayMs = options.delayMs ?? 100

  try {
    closeDatabase()
  } catch (error) {
    console.warn('[tempUserData] closeDatabase threw during cleanup:', error)
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await remove(userDataDir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !RETRYABLE_CODES.has(code) || attempt === retries) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }
}
