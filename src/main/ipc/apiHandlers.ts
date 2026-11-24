import { BrowserWindow } from 'electron'
import type { ApiClient } from '../ai/apiClient'
import type { ApiConfigManager } from '../ai/apiConfigManager'
import { isEncryptionAvailable } from '../config/secureStorage'
import { registerNoArgHandler, registerValidatedHandler } from './handlerRegistry'
import { ApiSchemas } from './validation'
import Logger from '../../shared/utils/logger'

function notifyConfigChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('api:config-changed')
  }
}

export function registerApiHandlers(apiClient: ApiClient, configManager: ApiConfigManager): void {
  registerNoArgHandler('api:get-config', async () => {
    return configManager.getPublicConfig()
  })

  registerValidatedHandler('api:save-config', ApiSchemas.saveConfig, async (args) => {
    const saved = await configManager.saveConfig(args)
    notifyConfigChanged()
    return saved
  })

  registerValidatedHandler('api:test-connection', ApiSchemas.testConnection, async (args) => {
    return apiClient.testConnection({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      clearApiKey: args.clearApiKey
    })
  })

  registerNoArgHandler('api:check-encryption', async () => {
    return { encrypted: isEncryptionAvailable() }
  })

  Logger.info('ApiHandlers', 'API configuration handlers registered')
}
