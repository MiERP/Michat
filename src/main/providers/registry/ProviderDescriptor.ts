/**
 * Provider Descriptor
 * Provider descriptor used for configuration-driven provider registration
 */

import type { BaseProvider } from '../capabilities/BaseProvider'

/**
 * Provider capability configuration
 */
export interface ProviderCapabilities {
  chat: boolean // Whether chat is supported
  embedding: boolean // Whether embeddings are supported
}

/**
 * Provider descriptor
 * Used for configuration-driven provider definitions
 */
export interface ProviderDescriptor {
  // Basic information
  name: string // Provider identifier (e.g. 'openai', 'deepseek')
  displayName: string // Display name (e.g. 'OpenAI', 'DeepSeek')
  isBuiltin: boolean // Whether it is a built-in provider
  locality?: 'local' | 'remote' // local-first privacy boundary

  // Default configuration
  defaultBaseUrl: string // Default API base URL
  defaultChatModel?: string // Default chat model
  defaultEmbeddingModel?: string // Default embedding model

  // Capability declarations
  capabilities: ProviderCapabilities

  // Provider factory function
  // Used to create Provider instances
  createProvider: (descriptor: ProviderDescriptor) => BaseProvider
}

/**
 * Custom provider configuration
 * Configuration used when users add a custom provider through the UI
 */
export interface CustomProviderConfig {
  providerName: string // Provider name
  displayName: string // Display name
  baseUrl: string // API base URL
  apiKey: string // API key
}
