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

interface DiscoveryEntry {
  model: string | null
  lastGood: string | null
  expiresAt: number
}

const MODEL_DISCOVERY_TTL_MS = 60_000
const MODEL_DISCOVERY_FAILURE_TTL_MS = 15_000

function normalizeBaseUrl(value: string, label: string): string {
  return assertLoopbackHttpUrl(value, label).toString().replace(/\/$/, '')
}

interface ModelPayload {
  data?: Array<{ id?: string; name?: string }>
  models?: Array<{ id?: string; name?: string }>
}

function modelIdsFrom(payload: ModelPayload): string[] {
  // Some servers return an empty `data` array alongside `models`. Prefer
  // whichever list actually contains entries.
  const entries =
    Array.isArray(payload.data) && payload.data.length > 0
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : []
  return entries.map((entry) => (entry.id ?? entry.name ?? '').trim()).filter(Boolean)
}

/** Server-controlled strings must not forge log lines with newlines or tabs. */
function logSafe(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 200)
}

class ApiClient {
  /**
   * One reusable client per capability. Rebuilding the Vercel AI SDK provider
   * on every query/embedding call was pure overhead; the cache key includes
   * every setting that changes the client, so a saved configuration is picked
   * up on the next call without a stale provider.
   */
  private readonly clients = new Map<ClientKind, CachedClient>()
  private readonly discoveredModels = new Map<string, DiscoveryEntry>()
  private readonly discoveryInFlight = new Map<string, Promise<string | null>>()

  constructor(private readonly configManager: ApiConfigManager) {}

  private cacheKey(kind: ClientKind, config: StoredApiConfig, model: string): string {
    return [kind, config.baseUrl, model, config.embeddingBaseUrl ?? '', config.apiKey ?? ''].join(
      '\u0000'
    )
  }

  /**
   * The server owns model selection. If the user did not pin a model id,
   * use the first model advertised by its OpenAI-compatible `/models` endpoint.
   */
  private async discoverModel(
    baseUrl: string,
    apiKey: string | undefined,
    kind: ClientKind
  ): Promise<string | null> {
    const cacheKey = `${kind}\u0000${baseUrl}\u0000${apiKey ?? ''}`
    const cached = this.discoveredModels.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.model

    const inFlight = this.discoveryInFlight.get(cacheKey)
    if (inFlight) return inFlight

    const request = this.fetchModel(
      baseUrl,
      apiKey,
      cacheKey,
      cached?.lastGood ?? null,
      kind
    ).finally(() => this.discoveryInFlight.delete(cacheKey))
    this.discoveryInFlight.set(cacheKey, request)
    return request
  }

  private async fetchModel(
    baseUrl: string,
    apiKey: string | undefined,
    cacheKey: string,
    lastGood: string | null,
    kind: ClientKind
  ): Promise<string | null> {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`
      const response = await fetch(`${baseUrl}/models`, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const payload = (await response.json()) as ModelPayload
      const ids = modelIdsFrom(payload)
      // A single OpenAI-compatible gateway may advertise both a chat model and
      // an embedding model. Pick a plausible id for each capability; fall back
      // to the first id when the server uses neutral names.
      const embeddingLike = /embed|bge|e5|gte/i
      let model: string | null
      if (kind === 'embedding') {
        const embeddingModel = ids.find((id) => embeddingLike.test(id))
        if (embeddingModel) {
          model = embeddingModel
        } else if (ids.length === 1) {
          // A single-model server (for example bge-m3 behind a neutral alias)
          // owns the only advertised id; use it whatever it is called.
          model = ids[0]
        } else {
          // Several ids and none looks like an embedding model: refuse rather
          // than silently embedding with a chat model. The connection test
          // and the settings page tell the user to load an embedding model.
          model = null
        }
      } else {
        model = ids.find((id) => !embeddingLike.test(id)) ?? ids[0] ?? null
      }

      // An empty list often means the external server is still loading. Keep
      // the last model that worked, and retry on the short failure TTL.
      const effectiveModel = model ?? lastGood
      const ttl = model ? MODEL_DISCOVERY_TTL_MS : MODEL_DISCOVERY_FAILURE_TTL_MS
      this.discoveredModels.set(cacheKey, {
        model: effectiveModel,
        lastGood: model ?? lastGood,
        expiresAt: Date.now() + ttl
      })
      if (model) Logger.info('ApiClient', `Discovered model: ${logSafe(model)}`)
      else Logger.warn('ApiClient', `Model discovery for ${logSafe(baseUrl)} returned no model`)
      return effectiveModel
    } catch (error) {
      Logger.warn('ApiClient', `Model discovery failed for ${logSafe(baseUrl)}:`, error)
      // A transient /models failure must not tear down a provider that was
      // already working; fall back to the last successfully discovered id.
      this.discoveredModels.set(cacheKey, {
        model: lastGood,
        lastGood,
        expiresAt: Date.now() + MODEL_DISCOVERY_FAILURE_TTL_MS
      })
      return lastGood
    }
  }

  private async createClient(
    kind: ClientKind,
    config: StoredApiConfig
  ): Promise<OpenAICompatibleClient | null> {
    if (!config.baseUrl) return null

    const baseUrl = normalizeBaseUrl(config.baseUrl, 'API base URL')
    // A separate embedding endpoint is optional, but must obey the same
    // loopback-only rule as the chat endpoint. Validate legacy stored values
    // here too, not just when the renderer saves a new configuration.
    const embeddingBaseUrl =
      kind === 'embedding' && config.embeddingBaseUrl
        ? normalizeBaseUrl(config.embeddingBaseUrl, 'Embedding API base URL')
        : undefined
    const endpoint = kind === 'embedding' ? (embeddingBaseUrl ?? baseUrl) : baseUrl
    // Model choice belongs to the external server. Legacy saved ids are
    // intentionally ignored so upgrading does not keep a stale alias alive.
    const model = await this.discoverModel(endpoint, config.apiKey, kind)
    if (!model) return null

    const key = this.cacheKey(kind, config, model)
    const cached = this.clients.get(kind)
    if (cached?.key === key) return cached.client

    const client = new OpenAICompatibleClient({
      name: 'michat-api',
      defaultBaseUrl: baseUrl,
      defaultChatModel: model,
      defaultEmbeddingModel: model,
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

  /** Drop cached providers after a configuration or server-model change. */
  clearCache(): void {
    this.clients.clear()
    this.discoveredModels.clear()
    this.discoveryInFlight.clear()
  }

  async getChatProvider(): Promise<ChatProvider | null> {
    const client = await this.createClient('chat', await this.configManager.getConfig())
    if (!client || !client.hasChatCapability()) {
      Logger.warn('ApiClient', 'Chat API is not configured')
      return null
    }
    return client
  }

  async getEmbeddingProvider(): Promise<EmbeddingProvider | null> {
    const client = await this.createClient('embedding', await this.configManager.getConfig())
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
    const provider = await this.getEmbeddingProvider()
    return provider?.getSignature?.() ?? null
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

      const payload = (await response.json()) as ModelPayload
      const models = modelIdsFrom(payload)

      if (models.length === 0) {
        return {
          ok: false,
          status: response.status,
          models,
          message:
            'Connected, but the server advertises no model. Load a model in the external server and retry.'
        }
      }

      return {
        ok: true,
        status: response.status,
        models,
        message: `Connected. ${models.length} model(s) available.`
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
