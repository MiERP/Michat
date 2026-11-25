/**
 * Shared shutdown flag for long-running maintenance work. The graceful-quit
 * barrier closes SQLite after a short cap; background rebuilds must stop
 * writing between batches once shutdown starts.
 */
let shuttingDown = false

export function beginShutdown(): void {
  shuttingDown = true
}

export function isShuttingDown(): boolean {
  return shuttingDown
}
