import { autoUpdater, UpdateInfo } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import Logger from '../../shared/utils/logger'
import { UpdateStatus, UpdateState } from '../../shared/types/update'
import { classifyUpdateError } from '../utils/updateErrors'

/**
 * Auto-update service
 */
export class UpdateService {
  private currentState: UpdateState = { status: UpdateStatus.IDLE }
  private mainWindow: BrowserWindow | null = null
  private silentCheck = false
  private checkPromise: Promise<unknown> | null = null

  constructor() {
    this.setupAutoUpdater()
  }

  /**
   * Set the main window reference (used to send update notifications)
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Configure electron-updater
   */
  private setupAutoUpdater(): void {
    // electron-updater logs raw response headers/cookies by default; keep all
    // updater logging in UpdateService, where messages are sanitized. Apply
    // this before the development early-return so the control is unconditional.
    autoUpdater.logger = null

    // Development environment configuration
    if (process.env.NODE_ENV === 'development') {
      Logger.info('UpdateService', 'Running in development mode, auto-update disabled')
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      return
    }

    // Production environment configuration
    autoUpdater.autoDownload = false
    // Never install silently: the user must choose "Install" explicitly.
    autoUpdater.autoInstallOnAppQuit = false
    // Unpackaged verification builds read dev-app-update.yml (a local generic
    // feed in tests); packaged builds always use app-update.yml.
    autoUpdater.forceDevUpdateConfig = !app.isPackaged

    Logger.info('UpdateService', 'Auto-updater configured')

    this.registerUpdateListeners()
  }

  private registerUpdateListeners(): void {
    autoUpdater.on('error', (error) => {
      const classified = classifyUpdateError(error)
      if (this.silentCheck) {
        Logger.warn('UpdateService', 'Silent update check failed:', classified.message)
        return
      }
      Logger.error('UpdateService', 'Update error:', classified.message)
      this.updateState({
        status: UpdateStatus.ERROR,
        errorKind: classified.kind
      })
    })

    autoUpdater.on('checking-for-update', () => {
      if (this.silentCheck) return
      Logger.info('UpdateService', 'Checking for updates...')
      this.updateState({
        status: UpdateStatus.CHECKING,
        errorKind: undefined
      })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      Logger.info('UpdateService', 'Update available:', info.version)
      this.updateState({
        status: UpdateStatus.AVAILABLE,
        info: { version: info.version },
        errorKind: undefined
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      Logger.info('UpdateService', 'Update not available, current version is latest')
      this.updateState({
        status: UpdateStatus.NOT_AVAILABLE,
        info: { version: info.version },
        errorKind: undefined
      })
    })

    autoUpdater.on('download-progress', (progressObj) => {
      Logger.debug('UpdateService', `Download progress: ${progressObj.percent.toFixed(2)}%`)
      this.updateState({
        status: UpdateStatus.DOWNLOADING,
        progress: {
          percent: progressObj.percent,
          transferred: progressObj.transferred,
          total: progressObj.total
        }
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      Logger.info('UpdateService', 'Update downloaded, waiting for user install:', info.version)
      this.updateState({
        status: UpdateStatus.DOWNLOADED,
        info: { version: info.version }
      })
    })
  }

  private updateState(newState: Partial<UpdateState>): void {
    if (newState.status === UpdateStatus.ERROR) {
      newState = { ...newState, info: undefined, progress: undefined }
    }
    this.currentState = { ...this.currentState, ...newState }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update:state-changed', this.currentState)
    }
  }

  async checkForUpdates(options: { silent?: boolean } = {}): Promise<UpdateState> {
    if (process.env.NODE_ENV === 'development') {
      Logger.warn('UpdateService', 'Auto-update is disabled in development mode')
      return {
        status: UpdateStatus.ERROR,
        errorKind: 'unknown'
      }
    }

    const silent = options.silent === true

    // A manual click near the 5-second startup check must not inherit the
    // silent flag from the in-flight automatic check. Let it settle, then run
    // a fresh non-silent check.
    if (!silent && this.checkPromise) {
      try {
        await this.checkPromise
      } catch {
        // The startup check already logged its sanitized failure.
      }
    }
    if (silent && this.checkPromise) return this.currentState

    this.silentCheck = silent
    let checkPromise: Promise<unknown> | null = null
    try {
      checkPromise = autoUpdater.checkForUpdates()
      this.checkPromise = checkPromise
      await checkPromise
      return this.currentState
    } catch (error) {
      const classified = classifyUpdateError(error)
      if (!silent) {
        Logger.error('UpdateService', 'Failed to check for updates:', classified.message)
        this.updateState({
          status: UpdateStatus.ERROR,
          errorKind: classified.kind
        })
      } else {
        Logger.warn('UpdateService', 'Silent update check failed:', classified.message)
      }
      return this.currentState
    } finally {
      if (this.checkPromise === checkPromise) this.checkPromise = null
      this.silentCheck = false
    }
  }

  async downloadUpdate(): Promise<void> {
    if (this.currentState.status !== UpdateStatus.AVAILABLE) {
      throw new Error('No update available to download')
    }

    try {
      Logger.info('UpdateService', 'Starting update download...')
      await autoUpdater.downloadUpdate()
    } catch (error) {
      const classified = classifyUpdateError(error)
      Logger.error('UpdateService', 'Failed to download update:', classified.message)
      this.updateState({
        status: UpdateStatus.ERROR,
        errorKind: classified.kind
      })
      throw new Error('update-failed')
    }
  }

  quitAndInstall(): void {
    if (this.currentState.status !== UpdateStatus.DOWNLOADED) {
      throw new Error('No update downloaded to install')
    }

    try {
      Logger.info('UpdateService', 'Quitting and installing update...')
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      const classified = classifyUpdateError(error)
      Logger.error('UpdateService', 'Failed to install update:', classified.message)
      this.updateState({
        status: UpdateStatus.ERROR,
        errorKind: classified.kind
      })
      throw new Error('update-failed')
    }
  }

  getState(): UpdateState {
    return { ...this.currentState }
  }

  async checkForUpdatesOnStartup(): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      return
    }

    setTimeout(() => {
      this.checkForUpdates({ silent: true }).catch((error) => {
        const classified = classifyUpdateError(error)
        Logger.warn('UpdateService', 'Startup update check failed:', classified.message)
      })
    }, 5000)
  }
}
