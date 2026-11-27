import { UpdateService } from '../services/UpdateService'
import Logger from '../../shared/utils/logger'
import { registerNoArgHandler } from './handlerRegistry'
import { classifyUpdateError } from '../utils/updateErrors'

/**
 * Registers the update-related IPC handlers. Every error string crossing IPC
 * is sanitized; raw updater messages can contain response headers and cookies.
 */
export function registerUpdateHandlers(updateService: UpdateService): void {
  registerNoArgHandler('update:check', async () => {
    try {
      Logger.info('UpdateHandlers', 'Checking for updates...')
      const state = await updateService.checkForUpdates()
      return { success: true, state }
    } catch (error) {
      const classified = classifyUpdateError(error)
      Logger.error('UpdateHandlers', 'Failed to check for updates:', classified.message)
      return { success: false, error: 'update-failed' }
    }
  })

  registerNoArgHandler('update:download', async () => {
    try {
      Logger.info('UpdateHandlers', 'Downloading update...')
      await updateService.downloadUpdate()
      return { success: true }
    } catch (error) {
      const classified = classifyUpdateError(error)
      Logger.error('UpdateHandlers', 'Failed to download update:', classified.message)
      return { success: false, error: 'update-failed' }
    }
  })

  registerNoArgHandler('update:install', async () => {
    try {
      Logger.info('UpdateHandlers', 'Installing update...')
      updateService.quitAndInstall()
      return { success: true }
    } catch (error) {
      const classified = classifyUpdateError(error)
      Logger.error('UpdateHandlers', 'Failed to install update:', classified.message)
      return { success: false, error: 'update-failed' }
    }
  })

  registerNoArgHandler('update:get-state', async () => {
    try {
      return { success: true, state: updateService.getState() }
    } catch (error) {
      const classified = classifyUpdateError(error)
      Logger.error('UpdateHandlers', 'Failed to get update state:', classified.message)
      return { success: false, error: 'update-failed' }
    }
  })

  Logger.info('UpdateHandlers', 'Update handlers registered')
}
