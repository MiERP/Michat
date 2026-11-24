/**
 * AI Provider type definitions
 * New architecture based on the capability composition pattern
 */

import type { APIMessage, StreamChunk } from '../../shared/types/chat'

// ==================== Exported shared types ====================
export type { APIMessage as ChatMessage, StreamChunk }

// ==================== Exported new capability interfaces ====================
export type { BaseProvider, LLMProviderConfig } from './capabilities/BaseProvider'
export type { ChatCapability } from './capabilities/ChatCapability'
export type {
  EmbeddingCapability,
  EmbeddingConfig,
  EmbeddingResult
} from './capabilities/EmbeddingCapability'

// ==================== Provider composition types ====================
import type { BaseProvider, LLMProviderConfig } from './capabilities/BaseProvider'
import type { ChatCapability } from './capabilities/ChatCapability'
import type { EmbeddingCapability } from './capabilities/EmbeddingCapability'
import type { EmbeddingConfig, EmbeddingResult } from './capabilities/EmbeddingCapability'

/**
 * Chat Provider
 * Provider that supports chat
 */
export type ChatProvider = BaseProvider & ChatCapability

/**
 * Embedding Provider
 * Provider that supports embeddings
 */
export type EmbeddingProvider = BaseProvider & EmbeddingCapability

/**
 * Full-featured Provider
 * Provider that supports both chat and embeddings
 */
export type FullFeaturedProvider = BaseProvider & ChatCapability & EmbeddingCapability

// ==================== Legacy interfaces (backward compatible, deprecated) ====================

/**
 * @deprecated Use the new capability composition types: ChatProvider, EmbeddingProvider, FullFeaturedProvider
 * Legacy LLMProvider interface, retained for backward compatibility
 */
export interface LLMProvider {
  readonly name: string
  configure(config: LLMProviderConfig): void
  sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController>
  validateConfig?(config: LLMProviderConfig): Promise<boolean>
  supportsEmbedding?(): boolean
  createEmbedding?(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult>
  createEmbeddings?(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]>
  getDefaultEmbeddingModel?(): string
}
