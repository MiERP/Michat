/**
 * Per-notebook gate for the in-place embedding rebuild. Document indexing
 * paths consult this so a concurrent import/auto-sync cannot write old-space
 * vectors while the rebuild owns the notebook.
 */
const rebuildingNotebooks = new Set<string>()
const activeIndexing = new Map<string, number>()

export function beginEmbeddingRebuild(notebookId: string): void {
  rebuildingNotebooks.add(notebookId)
}

export function endEmbeddingRebuild(notebookId: string): void {
  rebuildingNotebooks.delete(notebookId)
}

export function isEmbeddingRebuildActive(notebookId: string): boolean {
  return rebuildingNotebooks.has(notebookId)
}

export function beginIndexing(notebookId: string): void {
  activeIndexing.set(notebookId, (activeIndexing.get(notebookId) ?? 0) + 1)
}

export function endIndexing(notebookId: string): void {
  const next = (activeIndexing.get(notebookId) ?? 0) - 1
  if (next <= 0) activeIndexing.delete(notebookId)
  else activeIndexing.set(notebookId, next)
}

export function isIndexingActive(notebookId: string): boolean {
  return (activeIndexing.get(notebookId) ?? 0) > 0
}

/** Wait for an in-flight document index to finish before a rebuild clears vectors. */
export async function waitForIndexingToFinish(
  notebookId: string,
  timeoutMs = 120_000
): Promise<boolean> {
  const deadline = Date.now() + Math.max(timeoutMs, 1)
  while (isIndexingActive(notebookId)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return true
}
