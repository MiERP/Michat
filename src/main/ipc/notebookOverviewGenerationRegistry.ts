export class NotebookOverviewGenerationRegistry {
  private controllers = new Map<string, AbortController>()

  start(notebookId: string): AbortController {
    if (this.controllers.has(notebookId)) {
      throw new Error('Notebook overview generation is already in progress')
    }
    const controller = new AbortController()
    this.controllers.set(notebookId, controller)
    return controller
  }

  finish(notebookId: string, controller: AbortController): void {
    if (this.controllers.get(notebookId) === controller) {
      this.controllers.delete(notebookId)
    }
  }

  cancel(notebookId: string): boolean {
    const controller = this.controllers.get(notebookId)
    if (!controller) return false
    this.controllers.delete(notebookId)
    controller.abort()
    return true
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
}
