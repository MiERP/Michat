import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  }
}))

import { registerUpdateHandlers } from '../src/main/ipc/updateHandlers'
import type { UpdateService } from '../src/main/services/UpdateService'

const rawPrivateFeed = (): string =>
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'update', 'private-feed-error.txt'), 'utf8')

function event(): unknown {
  return { senderFrame: { url: 'file:///app/index.html' } }
}

function handler(channel: string): (event: unknown) => Promise<unknown> {
  const registered = state.handlers.get(channel)
  if (!registered) throw new Error(`${channel} handler not registered`)
  return registered as (event: unknown) => Promise<unknown>
}

function service(overrides: Partial<UpdateService> = {}): UpdateService {
  return {
    checkForUpdates: vi.fn(async () => ({ status: 'idle' })),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    getState: vi.fn(() => ({ status: 'idle' })),
    ...overrides
  } as unknown as UpdateService
}

describe('update IPC handlers sanitize every error path', () => {
  beforeEach(() => {
    state.handlers.clear()
  })

  it('returns a fixed error code for check failures', async () => {
    registerUpdateHandlers(
      service({
        checkForUpdates: vi.fn(async () => {
          throw new Error(rawPrivateFeed())
        })
      })
    )
    const result = (await handler('update:check')(event())) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('update-failed')
  })

  it('sanitizes download failures', async () => {
    registerUpdateHandlers(
      service({
        downloadUpdate: vi.fn(async () => {
          throw new Error(rawPrivateFeed())
        })
      })
    )
    const result = (await handler('update:download')(event())) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('update-failed')
  })

  it('sanitizes install failures', async () => {
    registerUpdateHandlers(
      service({
        quitAndInstall: vi.fn(() => {
          throw new Error(rawPrivateFeed())
        })
      })
    )
    const result = (await handler('update:install')(event())) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('update-failed')
  })

  it('sanitizes state lookup failures', async () => {
    registerUpdateHandlers(
      service({
        getState: vi.fn(() => {
          throw new Error(rawPrivateFeed())
        })
      })
    )
    const result = (await handler('update:get-state')(event())) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe('update-failed')
  })
})
