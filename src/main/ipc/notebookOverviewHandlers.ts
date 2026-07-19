import { ipcMain } from 'electron'
import { NotebookOverviewService } from '../services/NotebookOverviewService'
import Logger from '../../shared/utils/logger'
import { NotebookOverviewSchemas, validate, validateWithEvent } from './validation'
import { NotebookOverviewGenerationRegistry } from './notebookOverviewGenerationRegistry'

const registry = new NotebookOverviewGenerationRegistry()

export function cancelAllNotebookOverviewGenerations(): void {
  registry.cancelAll()
}

export function registerNotebookOverviewHandlers(service: NotebookOverviewService): void {
  ipcMain.handle(
    'notebook-overview:get',
    validate(NotebookOverviewSchemas.get, async ({ notebookId }) => service.getOverview(notebookId))
  )

  ipcMain.handle(
    'notebook-overview:cancel',
    validate(NotebookOverviewSchemas.cancel, async ({ notebookId }) => ({
      success: registry.cancel(notebookId)
    }))
  )

  ipcMain.handle(
    'notebook-overview:generate',
    validateWithEvent(NotebookOverviewSchemas.generate, async (event, { notebookId }) => {
      const controller = registry.start(notebookId)
      const abortOnWindowClosed = () => controller.abort()
      event.sender.once('destroyed', abortOnWindowClosed)
      try {
        const overview = await service.generate(
          notebookId,
          (stage, progress) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('notebook-overview:progress', { notebookId, stage, progress })
            }
          },
          controller.signal
        )
        return { success: true, overview }
      } catch (error) {
        if (controller.signal.aborted) {
          Logger.info(
            'NotebookOverviewHandlers',
            `Notebook overview generation cancelled: ${notebookId}`
          )
          return { success: false, error: 'Notebook overview generation cancelled' }
        }
        Logger.error('NotebookOverviewHandlers', 'Failed to generate notebook overview:', error)
        return { success: false, error: (error as Error).message }
      } finally {
        event.sender.removeListener('destroyed', abortOnWindowClosed)
        registry.finish(notebookId, controller)
      }
    })
  )
}
