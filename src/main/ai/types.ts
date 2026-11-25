import type { APIMessage, StreamChunk } from '../../shared/types/chat'

/** Minimal descriptor consumed by the OpenAI-compatible client. */
export interface ChatClientDescriptor {
  name: string
  defaultBaseUrl: string
  defaultChatModel?: string
  defaultEmbeddingModel?: string
  capabilities: {
    chat: boolean
    embedding: boolean
  }
}

/** Configuration passed to a client instance. */
export interface ClientConfig {
  apiKey?: string
  baseUrl?: string
  embeddingBaseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface GenerationOptions {
  temperature?: number
  maxTokens?: number
}

export interface ChatProvider {
  readonly name: string
  sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void,
    options?: GenerationOptions
  ): Promise<AbortController>
  getDefaultChatModel(): string
}

export interface EmbeddingConfig {
  model?: string
  dimensions?: number
}

export interface EmbeddingResult {
  embedding: Float32Array
  model: string
  /** Model + effective endpoint used for this vector. */
  signature?: string
  dimensions: number
  tokensUsed: number
}

export interface EmbeddingProvider {
  readonly name: string
  createEmbedding(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult>
  createEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]>
  getDefaultEmbeddingModel(): string
  /** Model + endpoint snapshot captured when this provider was configured. */
  getSignature?(): string | null
}

/** API configuration as stored on disk (apiKey may be encrypted). */
export interface StoredApiConfig {
  baseUrl: string
  apiKey?: string
  __encrypted_apiKey?: boolean
  chatModel: string
  embeddingModel: string
  embeddingBaseUrl?: string
  contextWindow: number
  updatedAt?: number
}

/** Renderer-safe API configuration. */
export type { PublicApiConfig, ApiTestResult, SaveApiConfigInput } from '../../shared/types/api'
