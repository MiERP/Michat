/**
 * OpenAI-compatible client
 * Talks to a local API exposed by another application.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, embed, embedMany } from 'ai'
import type { LanguageModel } from 'ai'
import type {
  ChatClientDescriptor,
  ChatProvider,
  ClientConfig,
  EmbeddingConfig,
  EmbeddingProvider,
  EmbeddingResult,
  GenerationOptions
} from './types'
import type { APIMessage, StreamChunk } from '../../shared/types/chat'
import Logger from '../../shared/utils/logger'
import { assertLoopbackHttpUrl } from '../security/guards'

const EMBEDDING_REQUEST_TIMEOUT_MS = 120_000

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
 * The loopback invariant must hold at the socket level: a compromised local
 * gateway must not be able to 307/308 the conversation or embedding body to a
 * remote host. Both provider transports therefore refuse redirects.
 */
const redirectRefusingFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: 'error' })

/**
 * Some chat templates (for example Gemma 4 E2B on llama.cpp) emit their
 * internal reasoning as ordinary content unless the template's thinking
 * switch is explicitly disabled. The reasoning can appear in another
 * language, so MiChat asks llama.cpp-compatible servers for a direct answer.
 * Servers whose template does not define `enable_thinking` ignore the field.
 */
export function withDirectAnswerTemplate(args: Record<string, unknown>): Record<string, unknown> {
  return {
    ...args,
    chat_template_kwargs: {
      ...(typeof args.chat_template_kwargs === 'object' && args.chat_template_kwargs !== null
        ? (args.chat_template_kwargs as Record<string, unknown>)
        : {}),
      enable_thinking: false
    }
  }
}

/**
 * OpenAICompatibleClient
 * Client backed by the Vercel AI SDK; model selection comes from ChatClientDescriptor.
 */
export class OpenAICompatibleClient implements ChatProvider, EmbeddingProvider {
  readonly name: string
  private descriptor: ChatClientDescriptor
  protected config: ClientConfig

  // AI SDK provider instance for the external OpenAI-compatible API.
  private aiProvider: ReturnType<typeof createOpenAICompatible> | null = null

  // Optional separate provider instance for embeddings (useful when embedding server runs on different baseUrl)
  private aiProviderEmbed: ReturnType<typeof createOpenAICompatible> | null = null

  /** Captured with the provider so a config change cannot relabel old vectors. */
  private configuredSignature: string | null = null

  constructor(descriptor: ChatClientDescriptor) {
    this.name = descriptor.name
    this.descriptor = descriptor

    // Initialize the default configuration
    this.config = {
      baseUrl: descriptor.defaultBaseUrl,
      model: descriptor.defaultChatModel || descriptor.defaultEmbeddingModel,
      temperature: 0.2,
      maxTokens: 2048
    }

    Logger.info('OpenAICompatibleClient', `Provider ${this.name} initialized`)
  }

  /**
   * Configure the Provider
   */
  configure(config: ClientConfig): void {
    this.config = { ...this.config, ...config }

    // Reset embed client each time we reconfigure
    this.aiProviderEmbed = null

    // Recreate the AI SDK provider instance. The external API may be keyless.
    this.aiProvider = createOpenAICompatible({
      name: this.name,
      baseURL: this.config.baseUrl || '',
      apiKey: config.apiKey || '',
      transformRequestBody: withDirectAnswerTemplate,
      fetch: redirectRefusingFetch
    })

    // Optional separate base URL for embeddings.
    const embedBaseUrl = this.config.embeddingBaseUrl
    const effectiveEmbedBaseUrl =
      embedBaseUrl && embedBaseUrl !== this.config.baseUrl
        ? assertLoopbackHttpUrl(embedBaseUrl, 'Embedding API base URL')
            .toString()
            .replace(/\/$/, '')
        : String(this.config.baseUrl || '').replace(/\/$/, '')

    if (embedBaseUrl && embedBaseUrl !== this.config.baseUrl) {
      this.aiProviderEmbed = createOpenAICompatible({
        name: `${this.name}-embed`,
        baseURL: effectiveEmbedBaseUrl,
        apiKey: config.apiKey || '',
        fetch: redirectRefusingFetch
      })
    } else {
      this.aiProviderEmbed = null
    }

    const signatureModel = this.config.model || this.descriptor.defaultEmbeddingModel
    this.configuredSignature =
      signatureModel && effectiveEmbedBaseUrl ? `${signatureModel}@${effectiveEmbedBaseUrl}` : null

    Logger.debug('OpenAICompatibleClient', `Provider ${this.name} configured`)
  }

  /** Model + endpoint captured when this client was configured. */
  getSignature(): string | null {
    return this.configuredSignature
  }

  // ==================== Chat capability ====================

  /**
   * Stream a chat completion and report chunks through callbacks.
   * TypeScript type guard
   */
  hasChatCapability(): this is ChatProvider {
    return this.descriptor.capabilities.chat && this.aiProvider !== null
  }

  /**
   * Type guard for the embedding capability.
   * TypeScript type guard
   */
  hasEmbeddingCapability(): this is EmbeddingProvider {
    if (this.aiProvider === null) return false
    return this.descriptor.capabilities.embedding
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
    onComplete: () => void,
    options?: GenerationOptions
  ): Promise<AbortController> {
    if (!this.aiProvider) {
      const error = new Error(
        `API client ${this.name} is not configured. Set the API base URL in Settings > API and load a model in the external server.`
      )
      onError(error)
      const abortController = new AbortController()
      abortController.abort()
      return abortController
    }

    if (!this.descriptor.capabilities.chat) {
      const error = new Error(`API client ${this.name} does not support chat capability`)
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
      const emitReasoningChunks = true
      try {
        Logger.debug('OpenAICompatibleClient', `Streaming with model: ${modelId}`)

        // Convert messages to the AI SDK core format.
        const coreMessages = convertToCoreMessages(messages)

        // Get the language model
        const model = this.aiProvider!(modelId)

        // Call AI SDK streamText
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: options?.temperature ?? this.config.temperature,
          maxOutputTokens: options?.maxTokens ?? this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // Stream tokens and metadata from the provider.
        // fullStream carries text, reasoning, usage and error parts.
        for await (const part of result.fullStream) {
          if (abortController.signal.aborted) {
            Logger.debug('OpenAICompatibleClient', 'Stream aborted by user')
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
              Logger.info('OpenAICompatibleClient', `Tool call: ${toolName ?? 'unknown'}`)
              break
            }

            case 'tool-result': {
              const toolName = (part as { toolName?: string }).toolName
              Logger.debug('OpenAICompatibleClient', `Tool result: ${toolName ?? 'unknown'}`)
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
          Logger.debug('OpenAICompatibleClient', 'Stream aborted')
          onComplete()
        } else {
          Logger.error('OpenAICompatibleClient', 'Stream error:', error)
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
      throw new Error(`No chat model configured for ${this.name}`)
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
      throw new Error(`API client ${this.name} does not support embedding capability`)
    }

    const modelId =
      config?.model || this.config.model || this.descriptor.defaultEmbeddingModel || ''

    if (!modelId) {
      throw new Error(`No embedding model configured for ${this.name}`)
    }

    Logger.debug('OpenAICompatibleClient', `Creating embedding with model: ${modelId}`)

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
      // A local server that stops responding must not hang indexing/rebuild
      // forever or block the shutdown barrier.
      abortSignal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
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
      'OpenAICompatibleClient',
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
      abortSignal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
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
   * Build provider-specific options for embedding requests.
   */
  private buildProviderOptions(
    config?: EmbeddingConfig
  ): Record<string, Record<string, number>> | undefined {
    if (!config?.dimensions) {
      return undefined
    }

    return {
      [this.name]: {
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

    if (noLogitsError) {
      const baseUrl = this.config.baseUrl || ''
      return new Error(
        [
          'The configured API cannot generate logits for this request.',
          `Current model: ${modelId}`,
          `Current baseUrl: ${baseUrl || '(empty)'}`,
          'Check that the chat model is a chat/instruct model (not an embedding-only model).'
        ].join(' ')
      )
    }

    const connectionRefused = messages.some((message) =>
      /ECONNREFUSED|connect\s+econnrefused/i.test(message)
    )

    if (connectionRefused) {
      const baseUrl = this.config.baseUrl || ''
      return new Error(
        [
          'Cannot connect to the configured local API.',
          `Target endpoint: ${baseUrl || '(empty)'}`,
          `Current model: ${modelId}`,
          'Check that the API application is running and that Settings > API points at its address.'
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
          'Check the API application logs for the first upstream error line.'
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
}
