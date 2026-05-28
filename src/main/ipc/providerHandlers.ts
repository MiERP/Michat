import { ipcMain, BrowserWindow } from 'electron'
import { ProviderManager } from '../providers/ProviderManager'
import { LlamaService } from '../services/LlamaService'
import { providersManager } from '../config'
import { enrichModelsWithType } from '../../shared/utils/modelClassifier'
import { ProviderSchemas, validate } from './validation'
import Logger from '../../shared/utils/logger'
import { assertLoopbackHttpUrl } from '../security/guards'

function inferModelTypeFromFilename(filename: string): 'chat' | 'embedding' | 'unknown' {
  const id = filename.toLowerCase()
  if (id.includes('bge') || id.includes('embed') || id.includes('embedding') || id.includes('e5')) {
    return 'embedding'
  }
  if (
    id.includes('qwen') ||
    id.includes('llama') ||
    id.includes('mistral') ||
    id.includes('instruct') ||
    id.includes('chat') ||
    id.includes('gemma') ||
    id.includes('phi') ||
    id.includes('deepseek') ||
    id.includes('yi-') ||
    id.includes('glm') ||
    id.includes('internlm') ||
    id.includes('vicuna') ||
    id.includes('orca')
  ) {
    return 'chat'
  }
  return 'unknown'
}

/**
 * Register Provider configuration IPC Handlers
 * Simplified: llama-only, no cloud provider logic.
 */
export function registerProviderHandlers(
  providerManager: ProviderManager,
  llamaService: LlamaService
) {
  // Save provider config
  ipcMain.handle(
    'save-provider-config',
    validate(ProviderSchemas.saveProviderConfig, async (args) => {
      const baseUrl = args.config?.baseUrl
      const embeddingBaseUrl = args.config?.embeddingBaseUrl

      if (typeof baseUrl === 'string' && baseUrl.trim()) {
        assertLoopbackHttpUrl(baseUrl, 'Provider base URL')
      }

      if (typeof embeddingBaseUrl === 'string' && embeddingBaseUrl.trim()) {
        assertLoopbackHttpUrl(embeddingBaseUrl, 'Provider embedding base URL')
      }

      await providersManager.saveProviderConfig(args.providerName, args.config, args.enabled)

      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('provider-config-changed')
      })
    })
  )

  // Get single provider config
  ipcMain.handle(
    'get-provider-config',
    validate(ProviderSchemas.getProviderConfig, async (args) => {
      return await providersManager.getProviderConfig(args.providerName)
    })
  )

  // Get all provider configs (inject local model list for settings UI)
  ipcMain.handle('get-all-provider-configs', async () => {
    const providers = await providersManager.getAllProviderConfigs()

    const llamaConfig = providers.find((p) => p.providerName === 'llama')
    if (llamaConfig) {
      try {
        const localGgufModels = llamaService.listModels()
        const modelDetails = localGgufModels.map((m) => ({
          id: m.filename,
          object: 'model',
          owned_by: 'llama-local',
          created: undefined,
          type: m.type || inferModelTypeFromFilename(m.filename)
        }))

        llamaConfig.config = {
          ...llamaConfig.config,
          models: modelDetails.map((m) => m.id),
          modelDetails
        }
      } catch (error) {
        Logger.warn('ProviderHandlers', 'Cannot inject local models into provider configs:', error)
      }
    }

    return providers
  })

  // Delete provider config
  ipcMain.handle(
    'delete-provider-config',
    validate(ProviderSchemas.deleteProviderConfig, async (args) => {
      await providersManager.deleteProviderConfig(args.providerName)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('provider-config-changed')
      })
    })
  )

  // Validate provider config
  ipcMain.handle(
    'validate-provider-config',
    validate(ProviderSchemas.validateProviderConfig, async (args) => {
      const provider = providerManager.getProvider(args.providerName)
      if (!provider || !provider.validateConfig) return false
      return provider.validateConfig(args.config)
    })
  )

  // Fetch models from llama.cpp server (OpenAI-compatible /v1/models)
  ipcMain.handle(
    'fetch-models',
    validate(ProviderSchemas.fetchModels, async (args) => {
      try {
        const providerConfig = await providersManager.getProviderConfig(args.providerName)
        const descriptor = providerManager.getDescriptor(args.providerName)
        const baseUrl = providerConfig?.config?.baseUrl || descriptor?.defaultBaseUrl || ''

        if (!baseUrl) {
          throw new Error(`No base URL configured for ${args.providerName}`)
        }

        const validatedBaseUrl = assertLoopbackHttpUrl(baseUrl, 'Provider base URL')

        // Build models endpoint from baseUrl
        const modelsUrl = `${validatedBaseUrl.toString().replace(/\/$/, '')}/models`

        Logger.info('ProviderHandlers', `Fetching models from: ${modelsUrl}`)

        const response = await fetch(modelsUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error'
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        const rawModels = data.data || data.models || []

        const models = enrichModelsWithType(
          rawModels.map((m: any) => ({
            id: m.id || m.name || '',
            object: m.object || 'model',
            owned_by: m.owned_by,
            created: m.created,
            type: m.type
          }))
        )

        await providersManager.saveProviderModels(args.providerName, models)

        Logger.info('ProviderHandlers', `Fetched ${models.length} models from ${args.providerName}`)
        return { models, source: 'remote' as const }
      } catch (error) {
        Logger.error('ProviderHandlers', 'Failed to fetch models:', error)
        throw new Error(`Cannot fetch models: ${(error as Error).message}`)
      }
    })
  )

  // Get cached models
  ipcMain.handle(
    'get-provider-models',
    validate(ProviderSchemas.getProviderModels, async (args) => {
      return await providersManager.getProviderModels(args.providerName)
    })
  )

  Logger.info('ProviderHandlers', 'Provider handlers registered (llama-only mode)')
}
