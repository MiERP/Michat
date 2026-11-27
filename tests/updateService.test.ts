import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateStatus } from '../src/shared/types/update'

const mocks = vi.hoisted(() => {
  // `vi.hoisted` runs before the ESM imports are initialised, so the module that
  // provides EventEmitter has to be loaded synchronously here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events') as typeof import('events')
  return {
    autoUpdater: Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      forceDevUpdateConfig: false,
      checkForUpdates: vi.fn(async () => undefined),
      downloadUpdate: vi.fn(async () => undefined),
      quitAndInstall: vi.fn()
    }),
    app: { isPackaged: true }
  }
})

vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))
vi.mock('electron', () => ({ app: mocks.app, BrowserWindow: class {} }))

import { UpdateService } from '../src/main/services/UpdateService'

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'update', name), 'utf8')

const rawPrivateFeed = (): string => fixture('private-feed-error.txt')

function fakeWindow(): {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
} {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

function createService(): {
  service: UpdateService
  window: ReturnType<typeof fakeWindow>
} {
  const service = new UpdateService()
  const window = fakeWindow()
  service.setMainWindow(window as unknown as Parameters<UpdateService['setMainWindow']>[0])
  return { service, window }
}

describe('UpdateService', () => {
  beforeEach(() => {
    mocks.autoUpdater.removeAllListeners()
    mocks.autoUpdater.checkForUpdates.mockReset()
    mocks.autoUpdater.downloadUpdate.mockReset()
    mocks.autoUpdater.quitAndInstall.mockReset()
    mocks.autoUpdater.checkForUpdates.mockResolvedValue(undefined)
    mocks.autoUpdater.downloadUpdate.mockResolvedValue(undefined)
    mocks.autoUpdater.quitAndInstall.mockReturnValue(undefined)
  })

  it('waits for an explicit install after an update is downloaded', () => {
    const { service } = createService()

    mocks.autoUpdater.emit('update-downloaded', { version: '1.2.3' })

    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(service.getState().status).toBe(UpdateStatus.DOWNLOADED)

    service.quitAndInstall()
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('disables auto-install-on-quit and enables dev config only when unpackaged', () => {
    const { service } = createService()
    expect(service).toBeDefined()
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(mocks.autoUpdater.forceDevUpdateConfig).toBe(false)
    expect(mocks.autoUpdater.logger).toBeNull()

    mocks.app.isPackaged = false
    createService()
    expect(mocks.autoUpdater.forceDevUpdateConfig).toBe(true)
    mocks.app.isPackaged = true
  })

  it('schedules the startup check after five seconds with silent=true', async () => {
    vi.useFakeTimers()
    try {
      const { service } = createService()
      const spy = vi.spyOn(service, 'checkForUpdates').mockResolvedValue({
        status: UpdateStatus.IDLE
      })

      await service.checkForUpdatesOnStartup()
      expect(spy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(spy).toHaveBeenCalledWith({ silent: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps state IDLE and emits nothing when a silent startup check fails', async () => {
    const raw = rawPrivateFeed()
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.autoUpdater.emit('error', new Error(raw))
      throw new Error(raw)
    })
    const { service, window } = createService()

    const state = await service.checkForUpdates({ silent: true })

    expect(state.status).toBe(UpdateStatus.IDLE)
    expect(state.errorKind).toBeUndefined()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('sets a sanitized categorized error for a manual failure', async () => {
    const raw = rawPrivateFeed()
    mocks.autoUpdater.checkForUpdates.mockImplementation(async () => {
      mocks.autoUpdater.emit('error', new Error(raw))
      throw new Error(raw)
    })
    const { service, window } = createService()

    const state = await service.checkForUpdates()

    expect(state.status).toBe(UpdateStatus.ERROR)
    expect(state.errorKind).toBe('feed-unavailable')
    expect(window.webContents.send).toHaveBeenCalled()
  })

  it('runs a fresh non-silent check when a manual click overlaps a silent check', async () => {
    let rejectFirst!: (error: Error) => void
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    mocks.autoUpdater.checkForUpdates
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => {
        mocks.autoUpdater.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:1'))
        return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1'))
      })
    const { service } = createService()

    const silent = service.checkForUpdates({ silent: true })
    const manual = service.checkForUpdates()
    rejectFirst(new Error(rawPrivateFeed()))

    await expect(silent).resolves.toMatchObject({ status: UpdateStatus.IDLE })
    const manualState = await manual

    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(manualState.status).toBe(UpdateStatus.ERROR)
    expect(manualState.errorKind).toBe('network')
  })

  it('resets the silent flag when checkForUpdates throws synchronously', async () => {
    mocks.autoUpdater.checkForUpdates.mockImplementationOnce(() => {
      throw new Error('sync failure')
    })
    const { service } = createService()

    const silent = await service.checkForUpdates({ silent: true })
    expect(silent.status).toBe(UpdateStatus.IDLE)

    mocks.autoUpdater.checkForUpdates.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:60999')
    )
    const manual = await service.checkForUpdates()
    expect(manual.status).toBe(UpdateStatus.ERROR)
    expect(manual.errorKind).toBe('network')
  })

  it('clears stale update info when an error replaces an available update', () => {
    const { service } = createService()
    mocks.autoUpdater.emit('update-available', { version: '2.2.5' })
    expect(service.getState().info?.version).toBe('2.2.5')

    mocks.autoUpdater.emit('error', new Error('server exploded'))
    expect(service.getState().status).toBe(UpdateStatus.ERROR)
    expect(service.getState().info).toBeUndefined()
  })

  it('sanitizes download failures and exposes the classified state', async () => {
    const raw = rawPrivateFeed()
    mocks.autoUpdater.downloadUpdate.mockRejectedValue(new Error(raw))
    const { service } = createService()
    mocks.autoUpdater.emit('update-available', { version: '2.2.5' })

    await expect(service.downloadUpdate()).rejects.toThrow('update-failed')
    const state = service.getState()

    expect(state.status).toBe(UpdateStatus.ERROR)
    expect(state.errorKind).toBe('feed-unavailable')
  })

  it('classifies a refused download connection as network', async () => {
    mocks.autoUpdater.downloadUpdate.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))
    const { service } = createService()
    mocks.autoUpdater.emit('update-available', { version: '2.2.5' })

    await expect(service.downloadUpdate()).rejects.toThrow('update-failed')
    expect(service.getState()).toMatchObject({
      status: UpdateStatus.ERROR,
      errorKind: 'network'
    })
  })

  it('handles an asynchronous installer error event after download', () => {
    const raw = rawPrivateFeed()
    const { service } = createService()
    mocks.autoUpdater.emit('update-downloaded', { version: '2.2.5' })
    mocks.autoUpdater.emit('error', new Error(raw))

    const state = service.getState()
    expect(state.status).toBe(UpdateStatus.ERROR)
    expect(state.errorKind).toBe('feed-unavailable')
  })

  it('sanitizes install failures and exposes the classified state', () => {
    mocks.autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('server exploded')
    })
    const { service } = createService()
    mocks.autoUpdater.emit('update-downloaded', { version: '2.2.5' })

    expect(() => service.quitAndInstall()).toThrow('update-failed')
    const state = service.getState()

    expect(state.status).toBe(UpdateStatus.ERROR)
    expect(state.errorKind).toBe('unknown')
  })
})
