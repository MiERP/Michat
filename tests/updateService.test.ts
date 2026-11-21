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
      checkForUpdates: vi.fn(async () => undefined),
      downloadUpdate: vi.fn(async () => undefined),
      quitAndInstall: vi.fn()
    })
  }
})

vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }))
vi.mock('electron', () => ({ BrowserWindow: class {} }))

import { UpdateService } from '../src/main/services/UpdateService'

describe('UpdateService install consent', () => {
  beforeEach(() => {
    mocks.autoUpdater.removeAllListeners()
    mocks.autoUpdater.quitAndInstall.mockClear()
  })

  it('waits for an explicit install after an update is downloaded', () => {
    const service = new UpdateService()

    mocks.autoUpdater.emit('update-downloaded', { version: '1.2.3' })

    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(service.getState().status).toBe(UpdateStatus.DOWNLOADED)

    service.quitAndInstall()
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('disables auto-install-on-quit', () => {
    new UpdateService()
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
  })
})
