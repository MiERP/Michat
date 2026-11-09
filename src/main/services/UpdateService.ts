import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow } from 'electron'
import Logger from '../../shared/utils/logger'
import { UpdateStatus, UpdateState } from '../../shared/types/update'

/**
 * 自动更新服务
 */
export class UpdateService {
  private currentState: UpdateState = { status: UpdateStatus.IDLE }
  private mainWindow: BrowserWindow | null = null

  constructor() {
    this.setupAutoUpdater()
  }

  /**
   * 设置主窗口引用（用于发送更新通知）
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 配置 electron-updater
   */
  private setupAutoUpdater(): void {
    // 开发环境配置
    if (process.env.NODE_ENV === 'development') {
      Logger.info('UpdateService', 'Running in development mode, auto-update disabled')
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = false
      return
    }

    // 生产环境配置
    autoUpdater.autoDownload = false
    // Never install silently: the user must choose "Install" explicitly.
    autoUpdater.autoInstallOnAppQuit = false

    Logger.info('UpdateService', 'Auto-updater configured')

    this.registerUpdateListeners()
  }

  private registerUpdateListeners(): void {
    autoUpdater.on('error', (error) => {
      Logger.error('UpdateService', 'Update error:', error)
      this.updateState({
        status: UpdateStatus.ERROR,
        error: error.message
      })
    })

    autoUpdater.on('checking-for-update', () => {
      Logger.info('UpdateService', 'Checking for updates...')
      this.updateState({ status: UpdateStatus.CHECKING })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      Logger.info('UpdateService', 'Update available:', info.version)
      this.updateState({
        status: UpdateStatus.AVAILABLE,
        info
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      Logger.info('UpdateService', 'Update not available, current version is latest')
      this.updateState({
        status: UpdateStatus.NOT_AVAILABLE,
        info
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
        info
      })
    })
  }


  private updateState(newState: Partial<UpdateState>): void {
    this.currentState = { ...this.currentState, ...newState }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update:state-changed', this.currentState)
    }
  }


  async checkForUpdates(): Promise<UpdateState> {
    if (process.env.NODE_ENV === 'development') {
      Logger.warn('UpdateService', 'Auto-update is disabled in development mode')
      return {
        status: UpdateStatus.ERROR,
        error: 'Auto-update is not available in development mode'
      }
    }

    try {
      Logger.info('UpdateService', 'Manually checking for updates...')
      await autoUpdater.checkForUpdates()
      return this.currentState
    } catch (error: any) {
      Logger.error('UpdateService', 'Failed to check for updates:', error)
      this.updateState({
        status: UpdateStatus.ERROR,
        error: error.message
      })
      return this.currentState
    }
  }

  async downloadUpdate(): Promise<void> {
    if (this.currentState.status !== UpdateStatus.AVAILABLE) {
      throw new Error('No update available to download')
    }

    try {
      Logger.info('UpdateService', 'Starting update download...')
      await autoUpdater.downloadUpdate()
    } catch (error: any) {
      Logger.error('UpdateService', 'Failed to download update:', error)
      this.updateState({
        status: UpdateStatus.ERROR,
        error: error.message
      })
      throw error
    }
  }

  quitAndInstall(): void {
    if (this.currentState.status !== UpdateStatus.DOWNLOADED) {
      throw new Error('No update downloaded to install')
    }

    Logger.info('UpdateService', 'Quitting and installing update...')

    autoUpdater.quitAndInstall(false, true)
  }

  getState(): UpdateState {
    return { ...this.currentState }
  }

  async checkForUpdatesOnStartup(): Promise<void> {
    if (process.env.NODE_ENV === 'development') {
      return
    }

    setTimeout(() => {
      this.checkForUpdates().catch((error) => {
        Logger.error('UpdateService', 'Startup update check failed:', error)
      })
    }, 5000)
  }
}
