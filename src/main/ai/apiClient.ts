import { OpenAICompatibleClient } from './OpenAICompatibleClient'
import type { ApiConfigManager } from './apiConfigManager'
import type { ChatProvider, EmbeddingProvider } from './types'
import type { ApiTestResult } from '../../shared/types/api'
import { assertLoopbackHttpUrl } from '../security/guards'
import Logger from '../../shared/utils/logger'

class ApiClient {
  constructor(private readonly configManager: ApiConfigManager) {}

  private async createClient(kind: 'chat' | 'embedding'): Promise<OpenAICompatibleClient | null> {
    const config = await this.configManager.getConfig()
    const model = kind === 'chat' ? config.chatModel : config.embeddingModel
    if (!config.baseUrl || !model) return null

    const client = new OpenAICompatibleClient({
      name: 'michat-api',
      defaultBaseUrl: config.baseUrl,
      defaultChatModel: config.chatModel,
      defaultEmbeddingModel: config.embeddingModel,
      capabilities: { chat: true, embedding: true }
    })
    client.configure({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model,
      embeddingBaseUrl: config.embeddingBaseUrl
    })
    return client
  }

  async getChatProvider(): Promise<ChatProvider | null> {
    const client = await this.createClient('chat')
    if (!client || !client.hasChatCapability()) {
      Logger.warn('ApiClient', 'Chat API is not configured')
      return null
    }
    return client
  }

  async getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
    const client = await this.createClient('embedding')
    if (!client || !client.hasEmbeddingCapability()) {
      Logger.warn('ApiClient', 'Embedding API is not configured')
      return null
    }
    return client
  }

  async getContextWindow(): Promise<number> {
    return (await this.configManager.getConfig()).contextWindow
  }

  async testConnection(draft?: {
    baseUrl?: string
    apiKey?: string
    clearApiKey?: boolean
  }): Promise<ApiTestResult> {
    const config = await this.configManager.getConfig()
    const baseUrl = (draft?.baseUrl ?? config.baseUrl).trim()
    if (!baseUrl) {
      return { ok: false, message: 'API base URL is empty' }
    }

    let apiKey = draft?.apiKey?.trim() || config.apiKey
    if (draft?.clearApiKey) apiKey = undefined

    try {
      const url = assertLoopbackHttpUrl(baseUrl, 'API base URL')
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`

      const response = await fetch(`${url.toString().replace(/\/$/, '')}/models`, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`
        }
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string; name?: string }>
        models?: Array<{ id?: string; name?: string }>
      }
      const models = (payload.data ?? payload.models ?? [])
        .map((model) => model.id ?? model.name ?? '')
        .filter(Boolean)

      return {
        ok: true,
        status: response.status,
        models,
        message:
          models.length > 0
            ? `Connected. ${models.length} model(s) available.`
            : 'Connected to the API.'
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      }
    }
  }
}

export { ApiClient }
