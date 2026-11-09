import type Store from 'electron-store'
import type { ProviderConfig } from './types'
import type { PublicProviderConfig } from '../../shared/types'
import { enrichModelsWithType } from '../../shared/utils/modelClassifier'
import {
  encryptProviderConfig,
  decryptProviderConfig,
  isEncryptionAvailable
} from './secureStorage'
import Logger from '../../shared/utils/logger'

function toPublicProvider(provider: ProviderConfig): PublicProviderConfig {
  const config = { ...(provider.config ?? {}) } as Record<string, unknown>
  const hasApiKey = typeof config.apiKey === 'string' && config.apiKey.length > 0
  delete config.apiKey
  delete config.__encrypted_apiKey
  return {
    providerName: provider.providerName,
    config,
    enabled: provider.enabled,
    updatedAt: provider.updatedAt,
    hasApiKey
  }
}

/**
 * 提供商配置管理器
 */
export class ProviderConfigManager {
  private getStore: () => Promise<Store<any>>

  constructor(getStore: () => Promise<Store<any>>) {
    this.getStore = getStore
  }

  /**
   * 保存提供商配置（自动加密敏感字段）
   *
   * The renderer never receives the stored key, so a save that omits apiKey
   * keeps the existing encrypted value. `clearApiKey` is the explicit way to
   * remove it.
   */
  async saveProviderConfig(
    providerName: string,
    config: Record<string, any>,
    enabled: boolean,
    options: { clearApiKey?: boolean } = {}
  ): Promise<{ encrypted: boolean }> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    const existing = providers[providerName] as ProviderConfig | undefined

    const nextConfig: Record<string, any> = { ...config }
    let carriedEncryptedKey = false

    if (options.clearApiKey) {
      delete nextConfig.apiKey
      delete nextConfig.__encrypted_apiKey
    } else if (!nextConfig.apiKey && existing?.config?.apiKey) {
      nextConfig.apiKey = existing.config.apiKey
      carriedEncryptedKey = Boolean(existing.config.__encrypted_apiKey)
      if (carriedEncryptedKey) {
        nextConfig.__encrypted_apiKey = true
      }
    }

    // 加密敏感字段（如 apiKey）. A key carried over from the store is already
    // encrypted; re-encrypting it would double-encrypt the ciphertext.
    let encryptedConfig = nextConfig
    if (nextConfig.apiKey && !carriedEncryptedKey && isEncryptionAvailable()) {
      encryptedConfig = encryptProviderConfig(nextConfig)
      Logger.info('ProviderConfigManager', `Config encrypted for ${providerName}`)
    } else if (nextConfig.apiKey && !carriedEncryptedKey) {
      Logger.warn(
        'ProviderConfigManager',
        `Encryption not available, storing config in plain text for ${providerName}`
      )
    }

    providers[providerName] = {
      providerName,
      config: encryptedConfig,
      enabled,
      updatedAt: Date.now()
    }

    store.set('providers', providers)

    return { encrypted: !nextConfig.apiKey || isEncryptionAvailable() }
  }

  /**
   * 获取提供商配置（自动解密敏感字段）
   */
  async getProviderConfig(providerName: string): Promise<ProviderConfig | null> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    const providerConfig = providers[providerName]

    if (!providerConfig) {
      return null
    }

    // 解密敏感字段
    const decryptedConfig = decryptProviderConfig(providerConfig.config)

    return {
      ...providerConfig,
      config: decryptedConfig
    }
  }

  /**
   * 获取所有提供商配置（自动解密敏感字段）
   */
  async getAllProviderConfigs(): Promise<ProviderConfig[]> {
    const store = await this.getStore()
    const providers = store.get('providers', {})

    // 解密每个配置
    return Object.values(providers).map((providerConfig: any) => ({
      ...providerConfig,
      config: decryptProviderConfig(providerConfig.config)
    }))
  }

  /** Renderer-safe view of one provider; the API key is never included. */
  async getPublicProviderConfig(providerName: string): Promise<PublicProviderConfig | null> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    const provider = providers[providerName] as ProviderConfig | undefined
    return provider ? toPublicProvider(provider) : null
  }

  /** Renderer-safe view of every provider; the API keys are never included. */
  async getPublicProviderConfigs(): Promise<PublicProviderConfig[]> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    return Object.values(providers).map((provider) => toPublicProvider(provider as ProviderConfig))
  }

  /**
   * 删除提供商配置
   */
  async deleteProviderConfig(providerName: string): Promise<void> {
    const store = await this.getStore()
    const providers = store.get('providers', {})
    delete providers[providerName]
    store.set('providers', providers)
  }

  /**
   * 监听提供商配置变化
   */
  async onProvidersChange(
    callback: (
      newProviders: Record<string, ProviderConfig>,
      oldProviders: Record<string, ProviderConfig>
    ) => void
  ): Promise<() => void> {
    const store = await this.getStore()
    return store.onDidChange('providers', (newValue, oldValue) => {
      if (newValue && oldValue) {
        callback(newValue, oldValue)
      }
    })
  }

  /**
   * 保存提供商模型列表
   */
  async saveProviderModels(providerName: string, models: any[]): Promise<void> {
    const store = await this.getStore()
    const modelsData = store.get('models', {})

    modelsData[providerName] = {
      models
    }

    store.set('models', modelsData)
  }

  /**
   * 获取提供商模型列表（带向后兼容）
   */
  async getProviderModels(providerName: string): Promise<any[]> {
    const store = await this.getStore()
    const modelsData = store.get('models', {})
    const providerModels = modelsData[providerName]

    let models = providerModels?.models || []

    // 向后兼容：如果模型没有 type 字段，自动添加
    const hasTypeField = models.length > 0 && models.some((m) => m.type)

    if (!hasTypeField && models.length > 0) {
      console.log(
        `[ProviderConfigManager] Migrating models for ${providerName} - adding type field`
      )
      models = enrichModelsWithType(models)
      // 更新存储
      await this.saveProviderModels(providerName, models)
    }

    return models
  }
}
