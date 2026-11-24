/**
 * File watchers and auto-sync for knowledge documents.
 *
 * Watches the managed copy directory and original source files, debounces
 * changes per document and reindexes through the document indexer. The
 * callback observer is injected so the facade stays the public entry point.
 */

import { createHash } from 'crypto'
import { join } from 'path'
import { copyFile, readFile, stat } from 'fs/promises'
import { existsSync, watch, type FSWatcher } from 'fs'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { documents, type Document } from '../../db/schema'
import type { KnowledgeFileStore } from './KnowledgeFileStore'
import type { AutoSyncPayload } from './KnowledgeServiceTypes'
import Logger from '../../../shared/utils/logger'

export interface KnowledgeAutoSyncServiceDeps {
  fileStore: KnowledgeFileStore
  reindexDocument: (documentId: string) => Promise<void>
}

export class KnowledgeAutoSyncService {
  private fileWatchers = new Map<string, FSWatcher>()
  private syncTimers = new Map<string, NodeJS.Timeout>()
  private autoSyncCallback?: (payload: AutoSyncPayload) => void
  private autoSyncRunning = false

  constructor(private readonly deps: KnowledgeAutoSyncServiceDeps) {}

  /**
   * Enable auto-sync: watch knowledge-files/ plus the original source file of
   * each file document. When a file changes → incremental reindex.
   */
  startAutoSync(callback?: (payload: AutoSyncPayload) => void): void {
    this.autoSyncCallback = callback
    if (this.fileWatchers.size > 0) return

    this.watchKnowledgeFilesDir()

    const db = getDatabase()
    const fileDocs = db.select().from(documents).where(eq(documents.type, 'file')).all()
    for (const doc of fileDocs) {
      if (doc.sourceUri) this.watchSourceFile(doc)
    }

    Logger.info('KnowledgeService', 'Auto-sync started')
  }

  stopAutoSync(): void {
    for (const watcher of this.fileWatchers.values()) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
    }
    this.fileWatchers.clear()
    for (const timer of this.syncTimers.values()) {
      clearTimeout(timer)
    }
    this.syncTimers.clear()
    this.autoSyncCallback = undefined
    Logger.info('KnowledgeService', 'Auto-sync stopped')
  }

  /**
   * Attach a watcher to the original source file (when the user edits the
   * file outside the app).
   */
  watchSourceFile(doc: Document): void {
    if (!doc.sourceUri) return
    const key = `source:${doc.id}`
    if (this.fileWatchers.has(key)) return
    if (!existsSync(doc.sourceUri)) {
      // The source can legitimately be moved or deleted outside MiChat. Keep
      // the indexed snapshot available, but do not attempt an invalid watcher
      // again on every application startup.
      Logger.info('KnowledgeService', `Auto-sync skipped missing source: ${doc.sourceUri}`)
      return
    }

    try {
      const watcher = watch(doc.sourceUri, () => {
        this.scheduleAutoSync(doc.id)
      })
      watcher.on('error', () => {
        this.fileWatchers.delete(key)
      })
      this.fileWatchers.set(key, watcher)
    } catch (error) {
      Logger.warn('KnowledgeService', `Cannot watch source file ${doc.sourceUri}:`, error)
    }
  }

  /** Forward an auto-sync payload to the registered observer (best-effort). */
  emit(payload: AutoSyncPayload): void {
    try {
      this.autoSyncCallback?.(payload)
    } catch (error) {
      Logger.error('KnowledgeService', 'Auto-sync callback error:', error)
    }
  }

  private watchKnowledgeFilesDir(): void {
    if (this.fileWatchers.has('knowledge-files-dir')) return

    try {
      const watcher = watch(this.deps.fileStore.knowledgeFilesDir, (_eventType, filename) => {
        if (!filename) return
        const doc = this.findDocumentByLocalFileName(filename)
        if (doc) this.scheduleAutoSync(doc.id)
      })
      watcher.on('error', () => {
        this.fileWatchers.delete('knowledge-files-dir')
      })
      this.fileWatchers.set('knowledge-files-dir', watcher)
    } catch (error) {
      Logger.warn('KnowledgeService', 'Cannot watch knowledge-files dir:', error)
    }
  }

  private findDocumentByLocalFileName(filename: string): Document | undefined {
    const db = getDatabase()
    return db
      .select()
      .from(documents)
      .where(eq(documents.localFilePath, join(this.deps.fileStore.knowledgeFilesDir, filename)))
      .get()
  }

  /**
   * Debounce 2 seconds per document (avoids repeated watcher events while a
   * file is being written).
   */
  private scheduleAutoSync(documentId: string): void {
    const existing = this.syncTimers.get(documentId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.syncTimers.delete(documentId)
      void this.autoSyncDocument(documentId)
    }, 2000)
    this.syncTimers.set(documentId, timer)
  }

  private async autoSyncDocument(documentId: string): Promise<void> {
    if (this.autoSyncRunning) {
      // Reschedule after the current pass finishes
      this.scheduleAutoSync(documentId)
      return
    }

    this.autoSyncRunning = true
    try {
      const db = getDatabase()
      const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()
      if (!doc || doc.type !== 'file') return

      // Pick the source: original file (sourceUri) first, otherwise the local
      // managed copy.
      const sourceExists = doc.sourceUri
        ? await stat(doc.sourceUri)
            .then(() => true)
            .catch(() => false)
        : false
      const sourcePath = sourceExists ? doc.sourceUri! : doc.localFilePath

      if (!sourcePath) {
        Logger.warn('KnowledgeService', `No source file for document ${documentId}, skip auto-sync`)
        return
      }

      if (sourcePath === doc.localFilePath && !this.deps.fileStore.isManagedPath(sourcePath)) {
        return
      }

      // Compare file bytes md5 before parsing (cheap).
      const fileBytes = await readFile(sourcePath)
      const fileMd5 = createHash('md5').update(fileBytes).digest('hex')
      const metadata = (doc.metadata as Record<string, unknown> | null) || {}
      const knownMd5 = typeof metadata.fileMd5 === 'string' ? metadata.fileMd5 : undefined

      if (knownMd5 === fileMd5 && doc.contentHash) return

      // If the source is the original file → overwrite the local copy, then
      // reparse.
      if (sourcePath !== doc.localFilePath && doc.localFilePath) {
        await copyFile(sourcePath, doc.localFilePath)
      }

      const result = await this.deps.reindexDocument(documentId)
      Logger.info(
        'KnowledgeService',
        `Auto-synced document ${documentId}`,
        result === undefined ? '' : result
      )

      // Update fileMd5 in metadata
      const updatedDoc = db.select().from(documents).where(eq(documents.id, documentId)).get()
      if (updatedDoc) {
        const updatedMetadata = { ...((updatedDoc.metadata as Record<string, unknown>) || {}) }
        updatedMetadata.fileMd5 = fileMd5
        db.update(documents)
          .set({ metadata: updatedMetadata })
          .where(eq(documents.id, documentId))
          .run()
      }

      this.emit({ documentId, documentTitle: doc.title, reason: 'file-changed' })
    } catch (error) {
      Logger.error('KnowledgeService', `Auto-sync failed for document ${documentId}:`, error)
      this.emit({
        documentId,
        documentTitle: documentId,
        reason: 'file-changed',
        error: (error as Error).message
      })
    } finally {
      this.autoSyncRunning = false
    }
  }
}
