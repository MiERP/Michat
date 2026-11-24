import { ipcMain, BrowserWindow } from 'electron'
import { settingsManager, type AppSettings, defaultSettings } from '../config'
import { SettingsSchemas, validate } from './validation'
import { registerNoArgHandler } from './handlerRegistry'

/**
 * Broadcasts settings changes to every window
 */
function broadcastSettingsChange(newSettings: AppSettings, oldSettings: AppSettings): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send('settings:changed', newSettings, oldSettings)
    }
  })
}

/**
 * Registers the settings IPC handlers
 */
export function registerSettingsHandlers(): void {
  // Get all settings
  registerNoArgHandler('settings:getAll', async () => {
    return await settingsManager.getAllSettings()
  })

  // Get a single setting (with argument validation)
  ipcMain.handle(
    'settings:get',
    validate(SettingsSchemas.get, async (args) => {
      return await settingsManager.getSetting(args.key as keyof AppSettings)
    })
  )

  // Update settings (with argument validation)
  ipcMain.handle(
    'settings:update',
    validate(SettingsSchemas.update, async (args) => {
      await settingsManager.updateSettings(args.updates)
      return await settingsManager.getAllSettings()
    })
  )

  // Set a single value (with argument validation)
  ipcMain.handle(
    'settings:set',
    validate(SettingsSchemas.set, async (args) => {
      const key = args.key as keyof AppSettings
      const value = args.value as AppSettings[typeof key]
      await settingsManager.setSetting(key, value)
      return await settingsManager.getSetting(key)
    })
  )

  // Reset settings
  registerNoArgHandler('settings:reset', async () => {
    await settingsManager.resetSettings()
    return await settingsManager.getAllSettings()
  })

  // Get the default prompts
  registerNoArgHandler('settings:getDefaultPrompts', async () => {
    return defaultSettings.prompts
  })

  // Listen for settings changes and broadcast them to every window
  settingsManager.onSettingsChange((newSettings, oldSettings) => {
    console.log('[IPC] Settings changed, broadcasting to all windows')
    broadcastSettingsChange(newSettings, oldSettings)
  })

  console.log('[IPC] Settings handlers registered')
}
