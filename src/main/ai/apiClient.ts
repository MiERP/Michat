import { OpenAICompatibleClient } from './OpenAICompatibleClient'
import type { ApiConfigManager } from './apiConfigManager'
import type { ChatProvider, EmbeddingProvider, StoredApiConfig } from './types'
import type { ApiTestResult } from '../../shared/types/api'
import { assertLoopbackHttpUrl } from '../security/guards'
import Logger from '../../shared/utils/logger'

type ClientKind = 'chat' | 'embedding'

interface CachedClient {
  key: string
  client: OpenAICompatibleClient
}

function normalizeBaseUrl(value: string, label: string): string {
  return assertLoopbackHttpUrl(value, label).toString().replace(/\/$/, '')
}

class ApiClient {
  /**
   * One reusable client per capability. Rebuilding the Vercel AI SDK provider
   * on every query/embedding call was pure overhead; the cache key includes
   * every setting that changes the client, so a saved configuration is picked
   * up on the next call without a stale provider.
   */
  private readonly clients = new Map<ClientKind, CachedClient>()

  constructor(private readonly configManager: ApiConfigManager) {}

  private cacheKey(kind: ClientKind, config: StoredApiConfig): string {
    return [
      kind,
      config.baseUrl,
      config.chatModel,
      config.embeddingModel,
      config.embeddingBaseUrl ?? '',
      config.apiKey ?? ''
    ].join('\u0000')
  }

  private createClient(kind: ClientKind, config: StoredApiConfig): OpenAICompatibleClient | null {
    const model = kind === 'chat' ? config.chatModel : config.embeddingModel
    if (!config.baseUrl || !model) return null

    const key = this.cacheKey(kind, config)
    const cached = this.clients.get(kind)
    if (cached?.key === key) return cached.client

    const baseUrl = normalizeBaseUrl(config.baseUrl, 'API base URL')
    // A separate embedding endpoint is optional, but must obey the same
    // loopback-only rule as the chat endpoint. Validate legacy stored values
    // here too, not just when the renderer saves a new configuration.
    const embeddingBaseUrl =
      kind === 'embedding' && config.embeddingBaseUrl
        ? normalizeBaseUrl(config.embeddingBaseUrl, 'Embedding API base URL')
        : undefined

    const client = new OpenAICompatibleClient({
      name: 'michat-api',
      defaultBaseUrl: baseUrl,
      defaultChatModel: config.chatModel,
      defaultEmbeddingModel: config.embeddingModel,
      capabilities: { chat: true, embedding: true }
    })
    client.configure({
      baseUrl,
      apiKey: config.apiKey,
      model,
      embeddingBaseUrl
    })
    this.clients.set(kind, { key, client })
    return client
  }

  /** Drop cached providers after a configuration change. */
  clearCache(): void {
    this.clients.clear()
  }

  async getChatProvider(): Promise<ChatProvider | null> {
    const client = this.createClient('chat', await this.configManager.getConfig())
    if (!client || !client.hasChatCapability()) {
      Logger.warn('ApiClient', 'Chat API is not configured')
      return null
    }
    return client
  }

  async getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
    const client = this.createClient('embedding', await this.configManager.getConfig())
    if (!client || !client.hasEmbeddingCapability()) {
      Logger.warn('ApiClient', 'Embedding API is not configured')
      return null
    }
    return client
  }

  async getContextWindow(): Promise<number> {
    return (await this.configManager.getConfig()).contextWindow
  }

  /**
   * Model + effective embedding endpoint. Vectors are only comparable when
   * both parts match, so this is persisted per notebook after a full embed.
   */
  async getEmbeddingSignature(): Promise<string | null> {
    const config = await this.configManager.getConfig()
    if (!config.baseUrl || !config.embeddingModel) return null

    try {
      const baseUrl = normalizeBaseUrl(
        config.embeddingBaseUrl || config.baseUrl,
        'Embedding API base URL'
      )
      return `${config.embeddingModel}@${baseUrl}`
    } catch {
      return null
    }
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
