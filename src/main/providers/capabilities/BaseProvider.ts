/**
 * BaseProvider interface
 * Base interface that all Providers must implement
 */

/**
 * Provider configuration
 */
export interface LLMProviderConfig {
  apiKey?: string
  baseUrl?: string
  /** Legacy spelling kept for stored configurations. */
  baseUrlembed?: string
  embeddingBaseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  [key: string]: unknown
}

/**
 * BaseProvider base interface
 * Defines the base methods that all Providers must implement
 */
export interface BaseProvider {
  /**
   * Provider name (unique identifier)
   */
  readonly name: string

  /**
   * Configure the Provider
   * @param config - Provider configuration options
   */
  configure(config: LLMProviderConfig): void

  /**
   * Validate whether the configuration is valid (optional)
   * @param config - Configuration to validate
   * @returns Promise<boolean> - Whether the configuration is valid
   */
  validateConfig?(config: LLMProviderConfig): Promise<boolean>
}
