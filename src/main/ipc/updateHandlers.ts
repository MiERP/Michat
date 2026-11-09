import { UpdateService } from '../services/UpdateService'
import Logger from '../../shared/utils/logger'
import { registerNoArgHandler } from './handlerRegistry'

/**
 * 注册更新相关的 IPC Handlers
 */
export function registerUpdateHandlers(updateService: UpdateService): void {
  registerNoArgHandler('update:check', async () => {
    try {
      Logger.info('UpdateHandlers', 'Checking for updates...')
      const state = await updateService.checkForUpdates()
      return { success: true, state }
    } catch (error) {
      Logger.error('UpdateHandlers', 'Failed to check for updates:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  registerNoArgHandler('update:download', async () => {
    try {
      Logger.info('UpdateHandlers', 'Downloading update...')
      await updateService.downloadUpdate()
      return { success: true }
    } catch (error) {
      Logger.error('UpdateHandlers', 'Failed to download update:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  registerNoArgHandler('update:install', async () => {
    try {
      Logger.info('UpdateHandlers', 'Installing update...')
      updateService.quitAndInstall()
      return { success: true }
    } catch (error) {
      Logger.error('UpdateHandlers', 'Failed to install update:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  registerNoArgHandler('update:get-state', async () => {
    try {
      return { success: true, state: updateService.getState() }
    } catch (error) {
      Logger.error('UpdateHandlers', 'Failed to get update state:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  Logger.info('UpdateHandlers', 'Update handlers registered')
}
