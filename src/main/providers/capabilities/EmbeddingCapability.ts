/**
 * EmbeddingCapability interface
 * Defines the embedding capability
 */

/**
 * Embedding configuration
 */
export interface EmbeddingConfig {
  model?: string // Embedding model name
  dimensions?: number // Vector dimensions (supported by some models)
}

/**
 * Embedding result
 */
export interface EmbeddingResult {
  embedding: Float32Array // Vector data
  model: string // Model used
  dimensions: number // Vector dimensions
  tokensUsed: number // Number of tokens consumed
}

/**
 * EmbeddingCapability embedding capability interface
 * Providers implementing this interface support embedding vector generation
 */
export interface EmbeddingCapability {
  /**
   * Generate an embedding for a single text
   * @param text - Input text
   * @param config - Embedding configuration
   * @returns Promise<EmbeddingResult> - Embedding result
   */
  createEmbedding(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult>

  /**
   * Batch generate embeddings
   * @param texts - Array of input texts
   * @param config - Embedding configuration
   * @returns Promise<EmbeddingResult[]> - Array of embedding results
   */
  createEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]>

  /**
   * Get the default embedding model
   * @returns Default embedding model name
   */
  getDefaultEmbeddingModel(): string
}
