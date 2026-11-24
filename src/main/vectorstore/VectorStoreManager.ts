/**
 * VectorStoreManager
 * Manages the VectorStore instances for different notebooks
 */

import type { VectorStore, VectorStoreType } from './types'
import { SQLiteVectorStore } from './SQLiteVectorStore'
import Logger from '../../shared/utils/logger'

/**
 * Vector store manager
 * Keeps an independent VectorStore instance per notebook
 */
export class VectorStoreManager {
  private stores: Map<string, VectorStore> = new Map()
  private defaultType: VectorStoreType = 'sqlite'
  private defaultDimensions: number = 1024

  /**
   * Returns or creates the VectorStore for a notebook
   * @param notebookId notebook ID
   * @param type storage type (optional, defaults to sqlite)
   * @param dimensions vector dimensions (optional; overrides the default when provided)
   */
  async getStore(
    notebookId: string,
    type?: VectorStoreType,
    dimensions?: number
  ): Promise<VectorStore> {
    const storeType = type || this.defaultType
    const key = `${notebookId}_${storeType}`
    const targetDimensions = dimensions || this.defaultDimensions

    // Check whether one already exists with matching dimensions
    const existingStore = this.stores.get(key)
    if (existingStore) {
      const existingDimensions = existingStore.getDimensions()
      if (existingDimensions === targetDimensions) {
        return existingStore
      } else {
        // Dimensions do not match; the store must be recreated
        Logger.warn(
          'VectorStoreManager',
          `Dimension mismatch for ${key}: existing=${existingDimensions}, new=${targetDimensions}. Recreating store.`
        )
        await existingStore.close()
        this.stores.delete(key)
      }
    }

    // Create a new VectorStore
    const store = this.createStore(storeType)
    await store.initialize({
      notebookId,
      dimensions: targetDimensions
    })

    this.stores.set(key, store)
    Logger.info(
      'VectorStoreManager',
      `Created ${storeType} store for notebook: ${notebookId} with dimensions: ${targetDimensions}`
    )

    return store
  }

  /**
   * Creates a VectorStore instance
   */
  private createStore(type: VectorStoreType): VectorStore {
    switch (type) {
      case 'sqlite':
        return new SQLiteVectorStore()
      case 'lancedb':
        // TODO: implement LanceDBVectorStore
        throw new Error('LanceDB vector store not implemented yet')
      case 'qdrant':
        // TODO: implement QdrantVectorStore
        throw new Error('Qdrant vector store not implemented yet')
      default:
        throw new Error(`Unknown vector store type: ${type}`)
    }
  }

  /**
   * Closes the store for the given notebook
   */
  async closeStore(notebookId: string): Promise<void> {
    const keysToDelete: string[] = []

    for (const [key, store] of this.stores) {
      // Use an exact notebook prefix to avoid accidental matches
      // (e.g. notebook_1 should not match notebook_10).
      if (key.startsWith(`${notebookId}_`)) {
        await store.close()
        keysToDelete.push(key)
        Logger.debug('VectorStoreManager', `Closed store: ${key}`)
      }
    }

    keysToDelete.forEach((key) => this.stores.delete(key))
  }

  /**
   * Closes all stores
   */
  async closeAll(): Promise<void> {
    for (const [key, store] of this.stores) {
      await store.close()
      Logger.debug('VectorStoreManager', `Closed store: ${key}`)
    }
    this.stores.clear()
    Logger.info('VectorStoreManager', 'All stores closed')
  }

  /**
   * Sets the default vector dimensions
   */
  setDefaultDimensions(dimensions: number): void {
    this.defaultDimensions = dimensions
  }

  /**
   * Returns the default vector dimensions
   */
  getDefaultDimensions(): number {
    return this.defaultDimensions
  }

  /**
   * Sets the default storage type
   */
  setDefaultType(type: VectorStoreType): void {
    this.defaultType = type
  }

  /**
   * Returns the number of open stores
   */
  getStoreCount(): number {
    return this.stores.size
  }
}

// Export the singleton instance
export const vectorStoreManager = new VectorStoreManager()
