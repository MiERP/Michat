import type Store from 'electron-store'
import type { StoreSchema } from '../config/types'
import type { PublicApiConfig } from '../../shared/types/api'
import type { StoredApiConfig } from '../ai/types'
import {
  encryptObjectFields,
  decryptObjectFields,
  isEncryptionAvailable
} from '../config/secureStorage'
import { assertLoopbackHttpUrl } from '../security/guards'
import Logger from '../../shared/utils/logger'

const SENSITIVE_FIELDS = ['apiKey']

export const DEFAULT_API_CONFIG: StoredApiConfig = {
  // llama-server's default port. Existing installs keep their saved URL.
  baseUrl: 'http://127.0.0.1:8080/v1',
  chatModel: '',
  embeddingModel: '',
  contextWindow: 8192
}

export interface SaveApiConfigInput {
  baseUrl?: string
  chatModel?: string
  embeddingModel?: string
  embeddingBaseUrl?: string
  contextWindow?: number
  apiKey?: string
  clearApiKey?: boolean
}

function normalizeBaseUrl(value: string, label = 'API base URL'): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const url = assertLoopbackHttpUrl(trimmed, label)
  return url.toString().replace(/\/$/, '')
}

function normalizeOptionalBaseUrl(value: string, label: string): string | undefined {
  const normalized = normalizeBaseUrl(value, label)
  return normalized || undefined
}

function toPublic(config: StoredApiConfig): PublicApiConfig {
  const hasApiKey = typeof config.apiKey === 'string' && config.apiKey.length > 0
  return {
    baseUrl: config.baseUrl,
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    embeddingBaseUrl: config.embeddingBaseUrl,
    contextWindow: config.contextWindow,
    hasApiKey
  }
}

/**
 * Stores the single external API configuration. The API key is encrypted at
 * rest when the platform supports it and is never returned to the renderer.
 */
export class ApiConfigManager {
  private getStore: () => Promise<Store<StoreSchema>>
  private cachedContextWindow = DEFAULT_API_CONFIG.contextWindow

  constructor(getStore: () => Promise<Store<StoreSchema>>) {
    this.getStore = getStore
  }

  getContextWindowSync(): number {
    return this.cachedContextWindow
  }

  async getConfig(): Promise<StoredApiConfig> {
    const store = await this.getStore()
    const stored = store.get('api', DEFAULT_API_CONFIG)
    const decrypted = decryptObjectFields(
      { ...DEFAULT_API_CONFIG, ...stored } as Record<string, unknown>,
      SENSITIVE_FIELDS
    ) as unknown as StoredApiConfig
    delete decrypted.__encrypted_apiKey
    this.cachedContextWindow = decrypted.contextWindow
    return decrypted
  }

  async getPublicConfig(): Promise<PublicApiConfig> {
    const store = await this.getStore()
    const stored = { ...DEFAULT_API_CONFIG, ...store.get('api', DEFAULT_API_CONFIG) }
    return toPublic(stored)
  }

  async saveConfig(input: SaveApiConfigInput): Promise<PublicApiConfig> {
    const store = await this.getStore()
    const existing = { ...DEFAULT_API_CONFIG, ...store.get('api', DEFAULT_API_CONFIG) }
    const next: StoredApiConfig = {
      ...existing,
      baseUrl: input.baseUrl === undefined ? existing.baseUrl : normalizeBaseUrl(input.baseUrl),
      chatModel: input.chatModel === undefined ? existing.chatModel : input.chatModel.trim(),
      embeddingModel:
        input.embeddingModel === undefined ? existing.embeddingModel : input.embeddingModel.trim(),
      embeddingBaseUrl:
        input.embeddingBaseUrl === undefined
          ? existing.embeddingBaseUrl
          : normalizeOptionalBaseUrl(input.embeddingBaseUrl, 'Embedding API base URL'),
      contextWindow:
        input.contextWindow === undefined
          ? existing.contextWindow
          : Math.min(Math.max(Math.round(input.contextWindow), 2048), 1_000_000),
      updatedAt: Date.now()
    }

    if (input.clearApiKey) {
      delete next.apiKey
      delete next.__encrypted_apiKey
    } else if (input.apiKey !== undefined) {
      if (input.apiKey.trim() === '') {
        delete next.apiKey
        delete next.__encrypted_apiKey
      } else {
        next.apiKey = input.apiKey.trim()
        delete next.__encrypted_apiKey
      }
    }

    let persisted = next as unknown as Record<string, unknown>
    if (typeof next.apiKey === 'string' && next.apiKey && !next.__encrypted_apiKey) {
      if (isEncryptionAvailable()) {
        persisted = encryptObjectFields(persisted, SENSITIVE_FIELDS)
        persisted.__encrypted_apiKey = true
      } else {
        Logger.warn('ApiConfig', 'Encryption unavailable; storing the API key in plain text')
      }
    }

    store.set('api', persisted as unknown as StoredApiConfig)
    this.cachedContextWindow = next.contextWindow
    return toPublic(next)
  }
}
