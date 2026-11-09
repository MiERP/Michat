import { dialog } from 'electron'
import { z } from 'zod'
import { LlamaService } from '../services/LlamaService'
import Logger from '../../shared/utils/logger'
import { registerNoArgHandler, registerValidatedHandler } from './handlerRegistry'

const LlamaSchemas = {
  importModel: z.object({ type: z.enum(['chat', 'embedding']) }),
  removeModel: z.object({ filename: z.string().min(1).max(255) })
}

/**
 * Register Llama model management IPC handlers.
 */
export function registerLlamaHandlers(llamaService: LlamaService): void {
  registerNoArgHandler('llama:list-models', async () => {
    try {
      return llamaService.listModels()
    } catch (error) {
      Logger.error('LlamaHandlers', 'Failed to list models:', error)
      return []
    }
  })

  registerValidatedHandler('llama:import-model', LlamaSchemas.importModel, async (args) => {
    try {
      const result = await dialog.showOpenDialog({
        title: `Select ${args.type} model (.gguf)`,
        filters: [{ name: 'GGUF Models', extensions: ['gguf'] }],
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, reason: 'cancelled' }
      }

      const sourcePath = result.filePaths[0]
      const imported = await llamaService.importModel(sourcePath, args.type)

      return {
        success: true,
        filename: imported.filename,
        sizeMB: imported.sizeMB,
        type: args.type
      }
    } catch (error) {
      Logger.error('LlamaHandlers', 'Failed to import model:', error)
      return { success: false, reason: (error as Error).message }
    }
  })

  registerValidatedHandler('llama:remove-model', LlamaSchemas.removeModel, async (args) => {
    try {
      llamaService.removeModel(args.filename)
      return { success: true }
    } catch (error) {
      Logger.error('LlamaHandlers', 'Failed to remove model:', error)
      return { success: false, reason: (error as Error).message }
    }
  })

  registerNoArgHandler('llama:get-server-info', async () => {
    const runtime = await llamaService.getRuntimeInfo()
    return {
      binary: llamaService.getLlamaServerBin(),
      chatPort: runtime.chatPort,
      embedPort: runtime.embedPort,
      backend: runtime.backend,
      chatCtxSize: runtime.chatCtxSize,
      embeddingCtxSize: runtime.embeddingCtxSize,
      threads: runtime.threads
    }
  })

  Logger.info('LlamaHandlers', 'Llama model management handlers registered')
}
