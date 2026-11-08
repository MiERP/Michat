/* eslint-disable no-irregular-whitespace */
/**
 * AI SDK Provider
 * ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒâ€¦Ã‚Â½ Vercel AI SDK ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»Ãƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Provider ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â°
 * ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â° OpenAI ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ API(OpenAI, DeepSeek, Qwen, Kimi, SiliconFlow ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â­ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°)
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
 * ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â°ÃƒÂ¢Ã¢â€šÂ¬  APIMessage ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Âº AI SDK ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ CoreMessage ÃƒÆ’Ã‚Â¦Ãƒâ€š Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚Â
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
 * ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒâ€¦Ã‚Â½ Vercel AI SDK ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»Ãƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ Provider ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â°
 * ÃƒÆ’Ã‚Â¦Ãƒâ€š Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â® ProviderDescriptor ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â®ÃƒÆ’Ã‚Â¥Ãƒâ€¦ Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¥Ãƒâ€¦ Ãƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½
 */
export class AISDKProvider implements BaseProvider {
  readonly name: string
  private descriptor: ProviderDescriptor
  protected config: LLMProviderConfig

  // AI SDK provider ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
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

    // ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â»Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¤ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â®
    this.config = {
      baseUrl: descriptor.defaultBaseUrl,
      model: descriptor.defaultChatModel || descriptor.defaultEmbeddingModel,
      temperature: 0.7,
      maxTokens: 2048
    }

    Logger.info('AISDKProvider', `Provider ${this.name} initialized`)
  }

  /**
   * ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â® Provider
   */
  configure(config: LLMProviderConfig): void {
    this.config = { ...this.config, ...config }

    // Reset embed client each time we reconfigure
    this.aiProviderEmbed = null

    // ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â°ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº AI SDK provider ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
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
        // OpenAI ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ provider
        this.aiProvider = createOpenAI({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'deepseek') {
        // DeepSeek ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ provider
        this.aiProvider = createDeepSeek({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'qwen') {
        // Qwen ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â¤Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Âº provider
        this.aiProvider = createQwen({
          baseURL: this.config.baseUrl,
          apiKey: config.apiKey
        })
      } else if (this.name === 'ollama') {
        // Ollama ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â¤Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Âº provider
        this.aiProvider = createOllama({
          baseURL: this.config.baseUrl || 'http://localhost:11434/api'
        })
        this.aiProviderEmbed = null
      } else {
        // ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¶ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â»ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â° provider ÃƒÆ’Ã‚Â©Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ OpenAI Compatible (Kimi, SiliconFlow, llama.cpp, etc.)
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
   * ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚ÂªÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â®ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¦ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€¹Ã¢â‚¬Â
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

  // ==================== ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â£ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ====================

  /**
   * ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â£ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¦ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº
   * TypeScript ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â±Ãƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â«
   */
  hasChatCapability(): this is BaseProvider & ChatCapability {
    return this.descriptor.capabilities.chat && this.aiProvider !== null
  }

  /**
   * ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â£ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¦ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂµÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Âº
   * TypeScript ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â±Ãƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â«
   */
  hasEmbeddingCapability(): this is BaseProvider & EmbeddingCapability {
    // Some local OpenAI-compatible servers (e.g. llama.cpp) may be able to serve embeddings even if
    // the descriptor capability flag is stale (older builds). Make llama robust by allowing it.
    if (this.aiProvider === null) return false
    if (this.descriptor.capabilities.embedding) return true
    // Fallback: allow embeddings for llama providers when configured.
    return this.name === 'llama' || this.name === 'llama-embed'
  }

  // ==================== ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ====================

  /**
   * ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯
   * ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¯
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

    // ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº AbortController
    const abortController = new AbortController()

    // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â­Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚Â§ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¡Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â
    ;(async () => {
      const modelId = this.config.model || this.descriptor.defaultChatModel!
      const emitReasoningChunks = this.name !== 'llama' && this.name !== 'llama-embed'
      try {
        Logger.debug('AISDKProvider', `Streaming with model: ${modelId}`)

        // ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¶Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€š Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚Â
        const coreMessages = convertToCoreMessages(messages)

        // ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â­ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¨ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
        const model = this.aiProvider!(modelId) as any

        // ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â°Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ AI SDK streamText
        const result = streamText({
          model,
          messages: coreMessages,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
          abortSignal: abortController.signal
        })

        // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¤ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂºÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
        // ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ fullStream ÃƒÆ’Ã‚Â¨ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â¯ textStream ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¿ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â¨ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â±ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â¤Ãƒâ€šÃ‚Âº
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

          // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¤ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â±Ãƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂµÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â©Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬
          switch (part.type) {
            case 'reasoning-start':
              if (!emitReasoningChunks) break
              // ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
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
              // ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¢Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹
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
              // ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬ ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€¦Ã‚Â¸
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
              // ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¢Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â­ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¡Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°
              onChunk({
                content: part.text,
                done: false
              })
              break
          }
        }

        // ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â­ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ metadata
        const finalResult = await result
        const usage = await finalResult.usage
        const finishReason = await finalResult.finishReason

        // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€š ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â°ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â« metadata
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
   * ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â»Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¤ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
   */
  getDefaultChatModel(): string {
    if (!this.descriptor.capabilities.chat) {
      throw new Error(`Provider ${this.name} does not support chat capability`)
    }
    return this.descriptor.defaultChatModel || ''
  }

  /**
   * ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ AI SDK ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ (ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒâ€¦Ã‚Â½ streamObject ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â­ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â«Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚ÂºÃƒâ€šÃ‚Â§ API)
   * @param modelId - ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ID,ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â®ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â»Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¤ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
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

  // ==================== ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂµÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ====================

  /**
   * ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂªÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ Embedding
   * ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂµÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¯
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

    // ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ AI SDK ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ embed ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â°
    // ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ provider ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â
    const providerForEmbed = this.aiProviderEmbed ?? this.aiProvider

    const embeddingModel =
      this.name === 'ollama'
        ? (providerForEmbed as any).embedding(modelId) // Ollama: embedding
        : (providerForEmbed as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, Qwen, OpenAI-Compatible: textEmbeddingModel

    // ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embed({
      model: embeddingModel,
      value: text,
      // Deterministic "input too large" errors must surface immediately so the
      // adaptive splitter can shrink the text instead of retrying the same call.
      maxRetries: 0,
      ...(providerOptions && { providerOptions }) // ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¡ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â¶ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â·Ãƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¥Ãƒâ€¦ Ãƒâ€š  providerOptions
    })

    return {
      embedding: new Float32Array(result.embedding),
      model: modelId,
      dimensions: result.embedding.length,
      tokensUsed: result.usage?.tokens || 0
    }
  }

  /**
   * ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â Embedding
   * ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂµÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¨Ãƒâ€ Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã‚Â¦Ãƒâ€¦ ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¯
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

    // ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ AI SDK ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ embedMany ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â°
    // ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ provider ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â
    const providerForEmbed = this.aiProviderEmbed ?? this.aiProvider

    const embeddingModel =
      this.name === 'ollama'
        ? (providerForEmbed as any).embedding(modelId) // Ollama: embedding
        : (providerForEmbed as any).textEmbeddingModel(modelId) // OpenAI, DeepSeek, Qwen, OpenAI-Compatible: textEmbeddingModel

    // ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº providerOptions
    const providerOptions = this.buildProviderOptions(config)

    const result = await embedMany({
      model: embeddingModel,
      values: texts,
      maxRetries: 0,
      ...(providerOptions && { providerOptions }) // ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº providerOptions
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
   * ÃƒÆ’Ã‚Â¨Ãƒâ€¦Ã‚Â½Ãƒâ€šÃ‚Â·ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â»Ãƒâ€¹Ã…â€œÃƒÆ’Ã‚Â¨Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¤ Embedding ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â¨Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹
   */
  getDefaultEmbeddingModel(): string {
    if (!this.descriptor.capabilities.embedding) {
      throw new Error(`Provider ${this.name} does not support embedding capability`)
    }
    return this.descriptor.defaultEmbeddingModel || ''
  }

  /**
   * ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Âº provider-specific ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°ÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â¡Ãƒâ€šÃ‚Â¹
   * ÃƒÆ’Ã‚Â¦Ãƒâ€š Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â® provider ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â±Ãƒâ€šÃ‚Â»ÃƒÆ’Ã‚Â¥Ãƒâ€¦Ã‚Â¾ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â©ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â®ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â providerOptions
   */
  private buildProviderOptions(config?: EmbeddingConfig): Record<string, any> | undefined {
    if (!config?.dimensions) {
      return undefined
    }

    // ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â dimensions ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢Ãƒâ€šÃ‚Â°ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ providersÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¹Ã¢â‚¬Â ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢Ãƒâ€šÃ‚Â½ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚ÂÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬Å“Ãƒâ€šÃ‚ÂºÃƒÆ’Ã‚Â¥Ãƒâ€¹Ã¢â‚¬Â Ãƒâ€šÃ‚Â¶ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°
    const supportedProviders = ['openai', 'deepseek', 'zhipu', 'siliconflow', 'openai-compatible']

    if (!supportedProviders.includes(this.name)) {
      Logger.debug(
        'AISDKProvider',
        `Provider ${this.name} does not support dimensions parameter, ignoring`
      )
      return undefined
    }

    // ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¯Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚ÂºÃƒâ€¦Ã‚Â½ OpenAI ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ providerÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¼Ãƒâ€¦Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â»Ãƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â§Ãƒâ€¦Ã‚Â¡ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾ÃƒÆ’Ã‚Â¦Ãƒâ€š Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€šÃ‚Â
    // SiliconFlow ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ 'openai' ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Âº providerKey
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

  // ==================== ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€¦Ã‚Â½ÃƒÆ’Ã‚Â¥ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦Ãƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â®Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â³ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢(ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â·Ãƒâ€šÃ‚Â²ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂºÃƒâ€¦Ã‚Â¸ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚Â¼Ãƒâ€ Ã¢â‚¬â„¢) ====================

  /**
   * @deprecated ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â½Ãƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â§ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¨ hasChatCapability() ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“ hasEmbeddingCapability() ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂºÃƒâ€šÃ‚Â¿ÃƒÆ’Ã‚Â¤Ãƒâ€šÃ‚Â»Ãƒâ€šÃ‚Â£
   * ÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â£ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã‚Â¸Ãƒâ€šÃ‚Â¥ÃƒÆ’Ã‚Â¦Ãƒâ€¹Ã…â€œÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¥Ãƒâ€šÃ‚ÂÃƒâ€šÃ‚Â¦ÃƒÆ’Ã‚Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒâ€šÃ‚Â¯ÃƒÆ’Ã‚Â¦Ãƒâ€¦Ã¢â‚¬â„¢Ãƒâ€šÃ‚Â Embedding
   */
  supportsEmbedding(): boolean {
    return this.hasEmbeddingCapability()
  }
}
