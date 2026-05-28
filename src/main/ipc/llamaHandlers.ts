import { ipcMain, dialog } from 'electron'
import { LlamaService } from '../services/LlamaService'
import Logger from '../../shared/utils/logger'

/**
 * Register Llama model management IPC handlers.
 */
export function registerLlamaHandlers(llamaService: LlamaService) {
  // List all .gguf models in the models directory
  ipcMain.handle('llama:list-models', async () => {
    try {
      return llamaService.listModels()
    } catch (error) {
      Logger.error('LlamaHandlers', 'Failed to list models:', error)
      return []
    }
  })

  // Import a .gguf model file (opens file dialog, copies to models dir)
  ipcMain.handle('llama:import-model', async (_event, args: { type: 'chat' | 'embedding' }) => {
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

  // Remove a model from the models directory
  ipcMain.handle('llama:remove-model', async (_event, args: { filename: string }) => {
    try {
      llamaService.removeModel(args.filename)
      return { success: true }
    } catch (error) {
      Logger.error('LlamaHandlers', 'Failed to remove model:', error)
      return { success: false, reason: (error as Error).message }
    }
  })

  // Get llama runtime info (for status display)
  ipcMain.handle('llama:get-server-info', async () => {
    const runtime = llamaService.getRuntimeInfo()
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
