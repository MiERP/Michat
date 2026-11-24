/**
 * AI SDK Provider
 * Local llama.cpp servers exposed through the OpenAI-compatible provider.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, embed, embedMany } from 'ai'
import type { LanguageModel } from 'ai'
import type { BaseProvider, LLMProviderConfig } from '../capabilities/BaseProvider'
import type { ChatCapability } from '../capabilities/ChatCapability'
import type { EmbeddingCapability } from '../capabilities/EmbeddingCapability'
import type { APIMessage, StreamChunk } from '../../../shared/types/chat'
import type { EmbeddingConfig, EmbeddingResult } from '../capabilities/EmbeddingCapability'
import type { ProviderDescriptor } from '../registry/ProviderDescriptor'
import Logger from '../../../shared/utils/logger'
import { assertLoopbackHttpUrl } from '../../security/guards'

const CONTROL_CHARS_PATTERN = new RegExp(
  '[' +
    String.fromCharCode(0) +
    '-' +
    String.fromCharCode(8) +
    String.fromCharCode(11) +
    String.fromCharCode(12) +
    String.fromCharCode(14) +
    '-' +
    String.fromCharCode(31) +
    String.fromCharCode(127) +
    ']',
  'g'
)

/**
 * Convert API messages into the AI SDK core message format.
 */
function convertToCoreMessages(messages: APIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: sanitizeMessageContent(msg.content)
  }))
}

function sanitizeMessageContent(content: string): string {
  return content.replace(CONTROL_CHARS_PATTERN, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * AISDKProvider
 * Unified Provider implementation backed by the Vercel AI SDK
 * Provider backed by the Vercel AI SDK; model selection comes from ProviderDescriptor.
 */
export class AISDKProvider implements BaseProvider {
  readonly name: string
  private descriptor: ProviderDescriptor
  protected config: LLMProviderConfig

  // AI SDK provider instance (OpenAI-compatible llama.cpp server).
  private aiProvider: ReturnType<typeof createOpenAICompatible> | null = null

  // Optional separate provider instance for embeddings (useful when embedding server runs on different baseUrl)
  private aiProviderEmbed: ReturnType<typeof createOpenAICompatible> | null = null

  constructor(descriptor: ProviderDescriptor) {
    this.name = descriptor.name
    this.descriptor = descriptor

    // Initialize the default configuration
    this.config = {
      baseUrl: descriptor.defaultBaseUrl,
      model: descriptor.defaultChatModel || descriptor.defaultEmbeddingModel,
      temperature: 0.7,
      maxTokens: 2048
    }

    Logger.info('AISDKProvider', `Provider ${this.name} initialized`)
  }

  /**
   * Configure the Provider
   */
  configure(config: LLMProviderConfig): void {
    this.config = { ...this.config, ...config }

    // Reset embed client each time we reconfigure
    this.aiProviderEmbed = null

    // Recreate the AI SDK provider instance
    // NOTE:
    // - Some local OpenAI-compatible servers (e.g. llama.cpp server) do not require an API key.
    // - Previously we only created the underlying AI SDK provider when apiKey exists (or Ollama).
    //   That makes keyless local servers unusable.
    // Only local llama.cpp providers are registered; both expose an
    // OpenAI-compatible API and do not require an API key.
    this.aiProvider = createOpenAICompatible({
      name: this.name,
      baseURL: this.config.baseUrl || '',
      apiKey: config.apiKey || ''
    })

    // If embedding server uses a different base URL (e.g., llama.cpp on :8001),
    // create a dedicated embedding client.
    const embedBaseUrl = this.config.baseUrlembed || this.config.embeddingBaseUrl
    if (embedBaseUrl && embedBaseUrl !== this.config.baseUrl) {
      this.aiProviderEmbed = createOpenAICompatible({
        name: `${this.name}-embed`,
        baseURL: embedBaseUrl,
        apiKey: config.apiKey || ''
      })
    } else {
      this.aiProviderEmbed = null
    }

    Logger.debug('AISDKProvider', `Provider ${this.name} configured`)
  }

  /**
   * Validate that the configured endpoint answers /models.
   */
  async validateConfig(config: LLMProviderConfig): Promise<boolean> {
    try {
      const baseUrl = assertLoopbackHttpUrl(config.baseUrl || '', 'Provider base URL')
      const headers: Record<string, string> = {}
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
      const response = await fetch(`${baseUrl.toString().replace(/\/$/, '')}/models`, {
        headers,
        redirect: 'error'
      })
      return response.ok
    } catch {
      return false
    }
  }

  // ==================== Chat capability ====================

  /**
   * Stream a chat completion and report chunks through callbacks.
   * TypeScript type guard
   */
  hasChatCapability(): this is BaseProvider & ChatCapability {
    return this.descriptor.capabilities.chat && this.aiProvider !== null
  }

  /**
   * Type guard for the embedding capability.
   * TypeScript type guard
   */
  hasEmbeddingCapability(): this is BaseProvider & EmbeddingCapability {
    // Some local OpenAI-compatible servers (e.g. llama.cpp) may be able to serve embeddings even if
    // the descriptor capability flag is stale (older builds). Make llama robust by allowing it.
    if (this.aiProvider === null) return false
    if (this.descriptor.capabilities.embedding) return true
    // Fallback: allow embeddings for llama providers when configured.
    return this.name === 'llama' || this.name === 'llama-embed'
  }

  // ==================== Embedding capability ====================

  /**
   * Stream messages
   * Create embeddings for a single text.
   */
  async sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController> {
    if (!this.aiProvider) {
      const error = new Error(
        `Provider ${this.name} is not configured. Please configure API key first.`
      )
      onError(error)
      const abortController = new AbortController()
      abortController.abort()
      return abortController
    }

    if (!this.descriptor.capabilities.chat) {
      const error = new Error(`Provider ${this.name} does not support chat capability`)
      onError(error)
      const abortController = new AbortController()
      abortController.abort()
      return abortController
    }

    // Create the AbortController
    const abortController = new AbortController()

    // Run streaming generation asynchronously
    ;(async () => {
      const modelId = this.config.model || this.descriptor.defaultChatModel!
      const emitReasoningChunks = this.name !== 'llama' && this.name !== 'llama-embed'
      try {
        Logger.debug('AISDKProvider', `Streaming with model: ${modelId}`)

        // Convert messages to the AI SDK core format.
        const coreMessages = convertToCoreMessages(messages)

        // Get the language model
        const model = this.aiProvider!(modelId)

        // Call AI SDK streamText
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // Stream tokens and metadata from the provider.
        // fullStream carries text, reasoning, usage and error parts.
        for await (const part of result.fullStream) {
          if (abortController.signal.aborted) {
            Logger.debug('AISDKProvider', 'Stream aborted by user')
            break
          }

          if (part.type === 'error') {
            const streamError =
              part.error instanceof Error
                ? part.error
                : new Error(
                    this.extractErrorMessages(part.error).join(' | ') || 'Unknown stream error'
                  )
            throw streamError
          }

          // Ignore parts that do not contribute to the answer.
          switch (part.type) {
            case 'reasoning-start':
              if (!emitReasoningChunks) break
              // Reasoning block started.
              onChunk({
                content: '',
                done: false,
                metadata: {
                  reasoningStart: true,
                  reasoningId: part.id
                }
              })
              break

            case 'reasoning-delta':
              if (!emitReasoningChunks) break
              // Reasoning delta.
              onChunk({
                content: part.text,
                done: false,
                metadata: {
                  isReasoning: true,
                  reasoningId: part.id
                }
              })
              break

            case 'reasoning-end':
              if (!emitReasoningChunks) break
              // Reasoning block ended.
              onChunk({
                content: '',
                done: false,
                metadata: {
                  reasoningEnd: true,
                  reasoningId: part.id
                }
              })
              break

            case 'tool-call': {
              const toolName = (part as { toolName?: string }).toolName
              Logger.info('AISDKProvider', `Tool call: ${toolName ?? 'unknown'}`)
              break
            }

            case 'tool-result': {
              const toolName = (part as { toolName?: string }).toolName
              Logger.debug('AISDKProvider', `Tool result: ${toolName ?? 'unknown'}`)
              break
            }

            case 'text-delta':
              // Assistant text delta.
              onChunk({
                content: part.text,
                done: false
              })
              break
          }
        }

        // Wait for the result to complete and retrieve metadata
        const finalResult = await result
        const usage = await finalResult.usage
        const finishReason = await finalResult.finishReason

        // Emit final usage metadata and mark the stream complete.
        onChunk({
          content: '',
          done: true,
          metadata: {
            model: modelId,
            finishReason: finishReason,
            usage: {
              promptTokens: usage.inputTokens || 0,
              completionTokens: usage.outputTokens || 0,
              totalTokens: usage.totalTokens || (usage.inputTokens || 0) + (usage.outputTokens || 0)
            }
          }
        })

        onComplete()
      } catch (error) {
        if (abortController.signal.aborted) {
          Logger.debug('AISDKProvider', 'Stream aborted')
          onComplete()
        } else {
          Logger.error('AISDKProvider', 'Stream error:', error)
          const normalizedError = this.normalizeChatStreamError(error, modelId)
          onError(normalizedError)
        }
      }
    })()

    return abortController
  }

  /**
   * Get the default chat model
   */
  getDefaultChatModel(): string {
    if (!this.descriptor.capabilities.chat) {
      throw new Error(`Provider ${this.name} does not support chat capability`)
    }
    return this.descriptor.defaultChatModel || ''
  }

  /**
   * Get an AI SDK model instance (for advanced APIs such as streamObject)
   * @param modelId - Model ID; uses the configured default model when omitted
   */
  getAIModel(modelId?: string): LanguageModel {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }
    const model = modelId || this.config.model || this.descriptor.defaultChatModel
    if (!model) {
      throw new Error(`No model specified for provider ${this.name}`)
    }
    return this.aiProvider(model)
  }

  // ==================== Embedding helpers ====================

  /**
   * Generate an embedding for a single text
   * Uses the configured embedding model.
   */
  async createEmbedding(text: string, config?: EmbeddingConfig): Promise<EmbeddingResult> {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }

    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }

    const modelId =
      config?.model || this.config.model || this.descriptor.defaultEmbeddingModel || ''

    if (!modelId) {
      throw new Error(`No embedding model specified for provider ${this.name}`)
    }

    Logger.debug('AISDKProvider', `Creating embedding with model: ${modelId}`)

    // Use the AI SDK embed function
    // Different providers use different method names
    const providerForEmbed = this.aiProviderEmbed ?? this.aiProvider

    const embeddingModel = providerForEmbed.textEmbeddingModel(modelId)

    // Build providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embed({
      model: embeddingModel,
      value: text,
      // Deterministic "input too large" errors must surface immediately so the
      // adaptive splitter can shrink the text instead of retrying the same call.
      maxRetries: 0,
      ...(providerOptions && { providerOptions }) // Add provider-specific options when available.
    })

    return {
      embedding: new Float32Array(result.embedding),
      model: modelId,
      dimensions: result.embedding.length,
      tokensUsed: result.usage?.tokens || 0
    }
  }

  /**
   * Batch generate embeddings
   * Create embeddings for a batch of texts.
   */
  async createEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<EmbeddingResult[]> {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }

    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }

    const modelId =
      config?.model || this.config.model || this.descriptor.defaultEmbeddingModel || ''

    if (!modelId) {
      throw new Error(`No embedding model specified for provider ${this.name}`)
    }

    Logger.debug(
      'AISDKProvider',
      `Creating embeddings for ${texts.length} texts with model: ${modelId}`
    )

    // Use the AI SDK embedMany function
    // Different providers use different method names
    const providerForEmbed = this.aiProviderEmbed ?? this.aiProvider

    const embeddingModel = providerForEmbed.textEmbeddingModel(modelId)

    // Build providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embedMany({
      model: embeddingModel,
      values: texts,
      maxRetries: 0,
      ...(providerOptions && { providerOptions }) // Build providerOptions
    })

    const totalTokens = result.usage?.tokens || 0
    const tokensPerEmbedding = Math.floor(totalTokens / texts.length)

    return result.embeddings.map((embedding) => ({
      embedding: new Float32Array(embedding),
      model: modelId,
      dimensions: embedding.length,
      tokensUsed: tokensPerEmbedding
    }))
  }

  /**
   * Get the default embedding model
   */
  getDefaultEmbeddingModel(): string {
    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }
    return this.descriptor.defaultEmbeddingModel || ''
  }

  /**
   * Build provider-specific options
   * Build provider-specific options for embedding requests.
   */
  private buildProviderOptions(
    config?: EmbeddingConfig
  ): Record<string, Record<string, number>> | undefined {
    if (!config?.dimensions) {
      return undefined
    }

    // Providers that support the dimensions parameter (allowlist)
    const supportedProviders = ['openai', 'deepseek', 'zhipu', 'siliconflow', 'openai-compatible']

    if (!supportedProviders.includes(this.name)) {
      Logger.debug(
        'AISDKProvider',
        `Provider ${this.name} does not support dimensions parameter, ignoring`
      )
      return undefined
    }

    // OpenAI-compatible providers use the 'openai' provider key; SiliconFlow is mapped below.
    // SiliconFlow uses 'openai' as the providerKey
    const providerKey = this.name === 'siliconflow' ? 'openai' : this.name

    return {
      [providerKey]: {
        dimensions: config.dimensions
      }
    }
  }

  private normalizeChatStreamError(error: unknown, modelId: string): Error {
    const messages = this.extractErrorMessages(error)

    const noLogitsError = messages.some((message) =>
      /no logits computation|does not logits computation|current context does not logits/i.test(
        message
      )
    )

    if (noLogitsError && (this.name === 'llama' || this.name === 'llama-embed')) {
      const baseUrl = this.config.baseUrl || ''
      return new Error(
        [
          'llama.cpp chat server cannot generate logits.',
          `Current model: ${modelId}`,
          `Current baseUrl: ${baseUrl || '(empty)'}`,
          'Likely causes:',
          '1) Chat is pointing to embedding server (usually :8001 instead of :8000).',
          '2) An embedding-only model is selected as chat model.',
          'Please set a chat/instruct model for chat and use chat endpoint (default: http://127.0.0.1:8000/v1).'
        ].join(' ')
      )
    }

    const connectionRefused = messages.some((message) =>
      /ECONNREFUSED|connect\s+econnrefused|127\.0\.0\.1:8000/i.test(message)
    )

    if (connectionRefused && (this.name === 'llama' || this.name === 'llama-embed')) {
      const baseUrl = this.config.baseUrl || 'http://127.0.0.1:8000/v1'
      return new Error(
        [
          'Cannot connect to local llama.cpp chat server.',
          `Target endpoint: ${baseUrl}`,
          `Current model: ${modelId}`,
          'The local server may have stopped or not started yet. Please verify llama-server is running on port 8000.'
        ].join(' ')
      )
    }

    const noOutputGenerated = messages.some((message) => /No output generated/i.test(message))
    if (noOutputGenerated) {
      const baseUrl = this.config.baseUrl || ''
      return new Error(
        [
          'Model stream ended without usable output.',
          `Current model: ${modelId}`,
          `Current baseUrl: ${baseUrl || '(empty)'}`,
          'Likely causes: upstream stream error, prompt too large, or invalid control characters in context.',
          'Please check llama-server stderr logs for the first upstream error line.'
        ].join(' ')
      )
    }

    if (error instanceof Error) return error
    return new Error(messages[0] || String(error))
  }

  private extractErrorMessages(error: unknown, visited = new WeakSet<object>()): string[] {
    if (error === null || error === undefined) return []

    if (typeof error === 'string') return [error]
    if (typeof error === 'number' || typeof error === 'boolean') return [String(error)]

    if (error instanceof Error) {
      const messages: string[] = [error.message]
      const maybeObject = error as unknown as Record<string, unknown>
      messages.push(...this.extractErrorMessages(maybeObject.cause, visited))
      messages.push(...this.extractErrorMessages(maybeObject.errors, visited))
      messages.push(...this.extractErrorMessages(maybeObject.lastError, visited))
      return messages
    }

    if (typeof error === 'object') {
      const obj = error as Record<string, unknown>
      if (visited.has(obj)) return []
      visited.add(obj)

      const messages: string[] = []
      if (typeof obj.message === 'string') messages.push(obj.message)
      if (typeof obj.responseBody === 'string') messages.push(obj.responseBody)
      if (typeof obj.stack === 'string') messages.push(obj.stack)

      messages.push(...this.extractErrorMessages(obj.cause, visited))
      messages.push(...this.extractErrorMessages(obj.errors, visited))
      messages.push(...this.extractErrorMessages(obj.lastError, visited))

      if (Array.isArray(obj.data)) {
        for (const item of obj.data) {
          messages.push(...this.extractErrorMessages(item, visited))
        }
      } else if (obj.data && typeof obj.data === 'object') {
        messages.push(...this.extractErrorMessages(obj.data, visited))
      }

      return messages
    }

    return [String(error)]
  }

  // ==================== Backward-compatible methods (deprecated) ====================

  /**
   * @deprecated Use hasChatCapability() or hasEmbeddingCapability() instead
   * Check whether embeddings are supported
   */
  supportsEmbedding(): boolean {
    return this.hasEmbeddingCapability()
  }
}
