/**
 * Readiness guard for the local embedding runtime.
 *
 * Every ingestion, retrieval and maintenance path must fail with the same
 * actionable errors, so the checks live in one small collaborator instead of
 * being re-implemented by each extracted module.
 */

import type { EmbeddingService } from '../EmbeddingService'
import { REQUIRED_EMBEDDING_DIMENSIONS } from '../../../shared/types/knowledge'

export class KnowledgeEmbeddingRuntime {
  constructor(private readonly embeddingService: EmbeddingService) {}

  /**
   * Verify that an embedding API is configured before indexing or searching.
   * This is the service-level guard for every caller (IPC, watcher, queue).
   */
  async ensureReady(): Promise<void> {
    await this.embeddingService.assertReady()
  }

  /**
   * Actual embedding dimensions of the configured model. Used by the UI to
   * verify a selection before keeping a new model.
   */
  async probeDimensions(): Promise<number> {
    await this.ensureReady()
    return this.embeddingService.probeDimensions()
  }

  /**
   * Fail early when the embedding model does not match the 1024-dimension
   * vector schema, before chunk/embedding rows are written.
   */
  async assertDimensions(): Promise<void> {
    const dimensions = await this.probeDimensions()
    if (dimensions !== REQUIRED_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding model returns ${dimensions}-dimensional vectors, but MiChat requires ` +
          `${REQUIRED_EMBEDDING_DIMENSIONS}. Choose a ${REQUIRED_EMBEDDING_DIMENSIONS}-dimension ` +
          'model (for example bge-m3).'
      )
    }
  }
}
