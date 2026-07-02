import { ipcMain } from 'electron'
import type { PodcastService } from '../services/PodcastService'

const activePodcastJobs = new Map<string, AbortController>()

export function registerPodcastHandlers(podcastService: PodcastService) {
  ipcMain.handle('podcast:generate-script', async (event, args: { notebookId: string }) => {
    const controller = new AbortController()
    activePodcastJobs.set(args.notebookId, controller)

    try {
      const result = await podcastService.generateScript(args.notebookId, {
        signal: controller.signal,
        onProgress: (stage, progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('podcast:progress', { notebookId: args.notebookId, stage, progress })
          }
        }
      })
      return { success: true, ...result }
    } catch (error) {
      const message = controller.signal.aborted ? 'Podcast generation cancelled' : (error as Error).message
      return { success: false, error: message, cancelled: controller.signal.aborted }
    } finally {
      activePodcastJobs.delete(args.notebookId)
    }
  })

  ipcMain.handle('podcast:cancel', async (_event, args: { notebookId: string }) => {
    const controller = activePodcastJobs.get(args.notebookId)
    if (!controller) return { success: false, error: 'No podcast job running' }
    controller.abort()
    activePodcastJobs.delete(args.notebookId)
    return { success: true }
  })

  ipcMain.handle('podcast:update', async (_event, args: { id: string; title: string }) => {
    try {
      podcastService.updateTitle(args.id, args.title)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('podcast:synthesize-audio', async () => {
    try {
      await podcastService.synthesizeAudio()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
