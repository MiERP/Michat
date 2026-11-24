/**
 * Ownership and lifecycle of the local copies under `knowledge-files/`.
 *
 * Keeping this boundary separate guarantees that only paths created by
 * MiChat are ever deleted while ingestion, auto-sync and document deletion
 * all share the same containment check.
 */

import { join } from 'path'
import { copyFile, mkdir, stat, unlink } from 'fs/promises'
import Logger from '../../../shared/utils/logger'
import { isPathInsideDirectory } from '../../security/guards'

export class KnowledgeFileStore {
  constructor(readonly knowledgeFilesDir: string) {}

  async ensureDir(): Promise<void> {
    try {
      await mkdir(this.knowledgeFilesDir, { recursive: true })
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to create knowledge files directory:', error)
    }
  }

  async copyToDir(sourceFilePath: string, documentId: string, extension: string): Promise<string> {
    await this.ensureDir()
    const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin'
    const localFilePath = join(this.knowledgeFilesDir, `${documentId}.${safeExtension}`)
    await copyFile(sourceFilePath, localFilePath)
    Logger.info('KnowledgeService', `File copied: ${sourceFilePath} -> ${localFilePath}`)
    return localFilePath
  }

  async deleteLocalFile(localFilePath: string): Promise<void> {
    if (!this.isManagedPath(localFilePath)) {
      Logger.warn('KnowledgeService', `Refusing to delete unmanaged path: ${localFilePath}`)
      return
    }
    try {
      const exists = await stat(localFilePath)
        .then(() => true)
        .catch(() => false)
      if (exists) {
        await unlink(localFilePath)
        Logger.info('KnowledgeService', `Local file deleted: ${localFilePath}`)
      }
    } catch (error) {
      Logger.error('KnowledgeService', 'Failed to delete local file:', error)
    }
  }

  isManagedPath(filePath: string): boolean {
    return isPathInsideDirectory(filePath, this.knowledgeFilesDir)
  }
}
