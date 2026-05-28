/**
 * AI SDK Provider
 * 基于 Vercel AI SDK 的统一 Provider 实现
 * 支持所有 OpenAI 兼容的 API(OpenAI, DeepSeek, Qwen, Kimi, SiliconFlow 等)
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createQwen } from 'qwen-ai-provider'
import { createOllama } from 'ollama-ai-provider-v2'
import { streamText, embed, embedMany } from 'ai'
import type { BaseProvider, LLMProviderConfig } from '../capabilities/BaseProvider'
import type { ChatCapability } from '../capabilities/ChatCapability'
import type { EmbeddingCapability } from '../capabilities/EmbeddingCapability'
import type { APIMessage, StreamChunk } from '../../../shared/types/chat'
import type { EmbeddingConfig, EmbeddingResult } from '../capabilities/EmbeddingCapability'
import type { ProviderDescriptor } from '../registry/ProviderDescriptor'
import Logger from '../../../shared/utils/logger'
import { assertLoopbackHttpUrl } from '../../security/guards'

/**
 * 将 APIMessage 转换为 AI SDK 的 CoreMessage 格式
 */
function convertToCoreMessages(messages: APIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: sanitizeMessageContent(msg.content)
  }))
}

function sanitizeMessageContent(content: string): string {
  return content
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/**
 * AISDKProvider
 * 基于 Vercel AI SDK 的统一 Provider 实现
 * 根据 ProviderDescriptor 的能力配置动态组合功能
 */
export class AISDKProvider implements BaseProvider {
  readonly name: string
  private descriptor: ProviderDescriptor
  protected config: LLMProviderConfig

  // AI SDK provider 实例
  private aiProvider:
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createOpenAICompatible>
    | ReturnType<typeof createDeepSeek>
    | ReturnType<typeof createQwen>
    | ReturnType<typeof createOllama>
    | null = null

  // Optional separate provider instance for embeddings (useful when embedding server runs on different baseUrl)
  private aiProviderEmbed:
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createOpenAICompatible>
    | ReturnType<typeof createDeepSeek>
    | ReturnType<typeof createQwen>
    | ReturnType<typeof createOllama>
    | null = null

  constructor(descriptor: ProviderDescriptor) {
    this.name = descriptor.name
    this.descriptor = descriptor

    // 初始化默认配置
    this.config = {
      baseUrl: descriptor.defaultBaseUrl,
      model: descriptor.defaultChatModel || descriptor.defaultEmbeddingModel,
      temperature: 0.7,
      maxTokens: 2048
    }

    Logger.info('AISDKProvider', `Provider ${this.name} initialized`)
  }

  /**
   * 配置 Provider
   */
  configure(config: LLMProviderConfig): void {
    this.config = { ...this.config, ...config }

    // Reset embed client each time we reconfigure
    this.aiProviderEmbed = null

    // 重新创建 AI SDK provider 实例
    // NOTE:
    // - Some local OpenAI-compatible servers (e.g. llama.cpp server) do not require an API key.
    // - Previously we only created the underlying AI SDK provider when apiKey exists (or Ollama).
    //   That makes keyless local servers unusable.
    const isLocalKeylessProvider =
      this.name === 'ollama' ||
      this.name === 'llama' ||
      this.name === 'llama-embed' ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(this.config.baseUrl || '')

    if (config.apiKey || isLocalKeylessProvider) {
      if (this.name === 'openai') {
        // OpenAI 使用官方 provider
        this.aiProvider = createOpenAI({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'deepseek') {
        // DeepSeek 使用官方 provider
        this.aiProvider = createDeepSeek({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'qwen') {
        // Qwen 使用社区 provider
        this.aiProvider = createQwen({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'ollama') {
        // Ollama 使用社区 provider
        this.aiProvider = createOllama({
          baseURL: this.config.baseUrl || 'http://localhost:11434/api'
        })
        this.aiProviderEmbed = null
      } else {
        // 其他所有 provider 都使用 OpenAI Compatible (Kimi, SiliconFlow, llama.cpp, etc.)
        this.aiProvider = createOpenAICompatible({
          name: this.name,
          baseURL: this.config.baseUrl || '',
          // For keyless local servers, empty apiKey is fine.
          apiKey: config.apiKey || ''
        })

        // If embedding server uses a different base URL (e.g., llama.cpp on :8001),
        // create a dedicated embedding client.
        const embedBaseUrl = ((this.config as any).baseUrlembed ||
          (this.config as any).embeddingBaseUrl) as string | undefined
        if (embedBaseUrl && embedBaseUrl !== this.config.baseUrl) {
          this.aiProviderEmbed = createOpenAICompatible({
            name: `${this.name}-embed`,
            baseURL: embedBaseUrl,
            apiKey: config.apiKey || ''
          })
        } else {
          this.aiProviderEmbed = null
        }
      }
    }

    Logger.debug('AISDKProvider', `Provider ${this.name} configured`)
  }

  /**
   * 验证配置是否有效
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

  // ==================== 能力检查方法 ====================

  /**
   * 检查是否支持对话能力
   * TypeScript 类型守卫
   */
  hasChatCapability(): this is BaseProvider & ChatCapability {
    return this.descriptor.capabilities.chat && this.aiProvider !== null
  }

  /**
   * 检查是否支持嵌入能力
   * TypeScript 类型守卫
   */
  hasEmbeddingCapability(): this is BaseProvider & EmbeddingCapability {
    // Some local OpenAI-compatible servers (e.g. llama.cpp) may be able to serve embeddings even if
    // the descriptor capability flag is stale (older builds). Make llama robust by allowing it.
    if (this.aiProvider === null) return false
    if (this.descriptor.capabilities.embedding) return true
    // Fallback: allow embeddings for llama providers when configured.
    return this.name === 'llama' || this.name === 'llama-embed'
  }

  // ==================== 对话能力方法 ====================

  /**
   * 流式发送消息
   * 如果不支持对话能力会抛出错误
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

    // 创建 AbortController
    const abortController = new AbortController()

    // 异步执行流式生成
    ;(async () => {
      const modelId = this.config.model || this.descriptor.defaultChatModel!
      const emitReasoningChunks = this.name !== 'llama' && this.name !== 'llama-embed'
      try {
        Logger.debug('AISDKProvider', `Streaming with model: ${modelId}`)

        // 转换消息格式
        const coreMessages = convertToCoreMessages(messages)

        // 获取语言模型
        const model = this.aiProvider!(modelId) as any

        // 调用 AI SDK streamText
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // 处理流式响应
        // 使用 fullStream 而不是 textStream 以支持推理过程展示
        for await (const part of result.fullStream) {
          if (abortController.signal.aborted) {
            Logger.debug('AISDKProvider', 'Stream aborted by user')
            break
          }

          if ((part as any)?.type === 'error') {
            const streamError =
              (part as any)?.error instanceof Error
                ? (part as any).error
                : new Error(
                    this.extractErrorMessages((part as any)?.error).join(' | ') ||
                      'Unknown stream error'
                  )
            throw streamError
          }

          // 处理不同类型的流式部分
          switch (part.type) {
            case 'reasoning-start':
              if (!emitReasoningChunks) break
              // 推理块开始
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
              // 推理增量内容
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
              // 推理块结束
              onChunk({
                content: '',
                done: false,
                metadata: {
                  reasoningEnd: true,
                  reasoningId: part.id
                }
              })
              break

            case 'text-delta':
              // 文本增量内容（最终答案）
              onChunk({
                content: part.text,
                done: false
              })
              break
          }
        }

        // 等待结果完成，获取 metadata
        const finalResult = await result
        const usage = await finalResult.usage
        const finishReason = await finalResult.finishReason

        // 发送完成标记，包含 metadata
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
   * 获取默认对话模型
   */
  getDefaultChatModel(): string {
    if (!this.descriptor.capabilities.chat) {
      throw new Error(`Provider ${this.name} does not support chat capability`)
    }
    return this.descriptor.defaultChatModel || ''
  }

  /**
   * 获取 AI SDK 模型实例 (用于 streamObject 等高级 API)
   * @param modelId - 模型ID,如果不提供则使用配置的默认模型
   */
  getAIModel(modelId?: string): any {
    if (!this.aiProvider) {
      throw new Error(`Provider ${this.name} is not configured. Please configure API key first.`)
    }
    const model = modelId || this.config.model || this.descriptor.defaultChatModel
    if (!model) {
      throw new Error(`No model specified for provider ${this.name}`)
    }
    return this.aiProvider(model)
  }

  // ==================== 嵌入能力方法 ====================

  /**
   * 生成单个文本的 Embedding
   * 如果不支持嵌入能力会抛出错误
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

    // 使用 AI SDK 的 embed 函数
    // 不同 provider 使用不同的方法名
    const providerForEmbed = this.aiProviderEmbed ?? this.aiProvider

    const embeddingModel =
      this.name === 'ollama'
        ? (providerForEmbed as any).embedding(modelId) // Ollama: embedding
        : (providerForEmbed as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, Qwen, OpenAI-Compatible: textEmbeddingModel

    // 构建 providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embed({
      model: embeddingModel,
      value: text,
      ...(providerOptions && { providerOptions }) // 条件添加 providerOptions
    })

    return {
      embedding: new Float32Array(result.embedding),
      model: modelId,
      dimensions: result.embedding.length,
      tokensUsed: result.usage?.tokens || 0
    }
  }

  /**
   * 批量生成 Embedding
   * 如果不支持嵌入能力会抛出错误
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

    // 使用 AI SDK 的 embedMany 函数
    // 不同 provider 使用不同的方法名
    const providerForEmbed = this.aiProviderEmbed ?? this.aiProvider

    const embeddingModel =
      this.name === 'ollama'
        ? (providerForEmbed as any).embedding(modelId) // Ollama: embedding
        : (providerForEmbed as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, Qwen, OpenAI-Compatible: textEmbeddingModel

    // 构建 providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embedMany({
      model: embeddingModel,
      values: texts,
      ...(providerOptions && { providerOptions }) // 条件添加 providerOptions
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
   * 获取默认 Embedding 模型
   */
  getDefaultEmbeddingModel(): string {
    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }
    return this.descriptor.defaultEmbeddingModel || ''
  }

  /**
   * 构建 provider-specific 选项
   * 根据 provider 类型和配置生成 providerOptions
   */
  private buildProviderOptions(config?: EmbeddingConfig): Record<string, any> | undefined {
    if (!config?.dimensions) {
      return undefined
    }

    // 支持 dimensions 参数的 providers（白名单机制）
    const supportedProviders = ['openai', 'deepseek', 'zhipu', 'siliconflow', 'openai-compatible']

    if (!supportedProviders.includes(this.name)) {
      Logger.debug(
        'AISDKProvider',
        `Provider ${this.name} does not support dimensions parameter, ignoring`
      )
      return undefined
    }

    // 对于 OpenAI 兼容的 provider，使用统一的格式
    // SiliconFlow 使用 'openai' 作为 providerKey
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

  // ==================== 向后兼容方法(已废弃) ====================

  /**
   * @deprecated 使用 hasChatCapability() 或 hasEmbeddingCapability() 替代
   * 检查是否支持 Embedding
   */
  supportsEmbedding(): boolean {
    return this.hasEmbeddingCapability()
  }
}
