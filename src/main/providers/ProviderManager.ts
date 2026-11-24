import type { BaseProvider } from './capabilities/BaseProvider'
import type { ChatProvider } from './types'
import type { EmbeddingProvider } from './types'
import type { ProviderDescriptor } from './registry/ProviderDescriptor'
import { ProviderRegistry } from './registry/ProviderRegistry'
import { BUILTIN_PROVIDERS } from './registry/builtinProviders'
import { AISDKProvider } from './base/AISDKProvider'
import { settingsManager, providerConfigManager } from '../config'
import Logger from '../../shared/utils/logger'
import { canUseProviderForLocalFirst } from './providerPolicy'

/**
 * ProviderManager
 * Provider manager that coordinates the registry and configuration management
 */
export class ProviderManager {
  private registry: ProviderRegistry

  constructor() {
    this.registry = new ProviderRegistry()

    // Register all built-in providers
    this.registerBuiltinProviders()

    Logger.info('ProviderManager', 'Provider manager initialized')
  }

  async initialize(): Promise<void> {
    Logger.info('ProviderManager', 'Provider manager initialization complete (llama-only mode)')
  }

  /**
   * Register all built-in providers
   */
  private registerBuiltinProviders(): void {
    this.registry.registerMany(BUILTIN_PROVIDERS)
    Logger.info(
      'ProviderManager',
      `Registered ${BUILTIN_PROVIDERS.length} builtin providers: ${BUILTIN_PROVIDERS.map((p) => p.name).join(', ')}`
    )
  }

  /**
   * Get a configured provider (merged configuration)
   * @param name - Provider name
   * @returns BaseProvider or null
   */
  async getConfiguredProvider(name: string): Promise<BaseProvider | null> {
    const provider = this.registry.getProvider(name)
    if (!provider) {
      Logger.warn('ProviderManager', `Provider ${name} not found in registry`)
      return null
    }

    // Get the user configuration
    const config = await providerConfigManager.getProviderConfig(name)
    if (!config || !config.enabled) {
      Logger.warn('ProviderManager', `Provider ${name} is not enabled`)
      return null
    }

    // Configure the provider
    const descriptor = this.registry.getDescriptor(name)
    if (!descriptor || !canUseProviderForLocalFirst(descriptor, config)) {
      Logger.error(
        'ProviderManager',
        `Provider ${name} is blocked by the local-first policy (loopback endpoints only).`
      )
      return null
    }

    provider.configure(config.config)
    return provider
  }

  /**
   * Get the active chat provider
   * If the user set a default chat model but it is unavailable, returns null directly without automatic fallback
   */
  async getActiveChatProvider(): Promise<ChatProvider | null> {
    try {
      const settings = await settingsManager.getAllSettings()
      const defaultChatModel = settings.defaultChatModel

      // If the user set a default chat model, parse and use it
      if (defaultChatModel && defaultChatModel.includes(':')) {
        const [providerName, ...modelIdParts] = defaultChatModel.split(':')
        const modelId = modelIdParts.join(':')

        if (
          providerName === 'llama' &&
          /\b(bge|embed|embedding|e5)\b/i.test(modelId.replace(/[-_.]/g, ' '))
        ) {
          Logger.error(
            'ProviderManager',
            `Invalid chat model selected for llama: ${modelId}. This looks like an embedding model.`
          )
          return null
        }

        const provider = await this.getConfiguredProvider(providerName)

        if (!provider) {
          Logger.error(
            'ProviderManager',
            `Provider for default chat model "${providerName}" is not available or not enabled`
          )
          return null
        }

        // Check whether chat capability is supported
        const compatProvider = provider as AISDKProvider
        if (!compatProvider.hasChatCapability()) {
          Logger.error(
            'ProviderManager',
            `Provider ${providerName} does not support chat capability`
          )
          return null
        }

        // Use the specified model configuration
        compatProvider.configure({ model: modelId })
        Logger.info('ProviderManager', `Using default chat model: ${providerName} - ${modelId}`)
        return compatProvider as ChatProvider
      }

      // If no default chat model is configured, return null
      Logger.warn('ProviderManager', 'No default chat model configured')
      return null
    } catch (error) {
      Logger.error('ProviderManager', 'Failed to get active chat provider:', error)
      return null
    }
  }

  /**
   * Get the active embedding provider
   * If the user set a default embedding model but it is unavailable, returns null directly without automatic fallback
   */
  async getActiveEmbeddingProvider(): Promise<EmbeddingProvider | null> {
    try {
      const settings = await settingsManager.getAllSettings()
      const defaultEmbeddingModel = settings.defaultEmbeddingModel

      // If the user set a default embedding model, parse and use it
      if (defaultEmbeddingModel && defaultEmbeddingModel.includes(':')) {
        const [providerName, ...modelIdParts] = defaultEmbeddingModel.split(':')
        const modelId = modelIdParts.join(':')
        const provider = await this.getConfiguredProvider(providerName)

        if (!provider) {
          Logger.error(
            'ProviderManager',
            `Provider for default embedding model "${providerName}" is not available or not enabled`
          )
          return null
        }

        // Check whether embedding capability is supported
        const compatProvider = provider as AISDKProvider
        if (!compatProvider.hasEmbeddingCapability()) {
          Logger.error(
            'ProviderManager',
            `Provider ${providerName} does not support embedding capability`
          )
          return null
        }

        // Use the specified model configuration
        compatProvider.configure({ model: modelId })
        Logger.info(
          'ProviderManager',
          `Using default embedding model: ${providerName} - ${modelId}`
        )
        return compatProvider as EmbeddingProvider
      }

      // If no default embedding model is configured, return null
      Logger.warn('ProviderManager', 'No default embedding model configured')
      return null
    } catch (error) {
      Logger.error('ProviderManager', 'Failed to get active embedding provider:', error)
      return null
    }
  }

  /**
   * List all registered provider names
   */
  listProviders(): string[] {
    return this.registry.listProviderNames()
  }

  /**
   * Get a provider descriptor
   */
  getDescriptor(name: string): ProviderDescriptor | undefined {
    return this.registry.getDescriptor(name)
  }

  /**
   * List all provider descriptors
   */
  listDescriptors(): ProviderDescriptor[] {
    return this.registry.listDescriptors()
  }

  /**
   * Get providers by capability
   */
  getProvidersByCapability(capability: 'chat' | 'embedding'): ProviderDescriptor[] {
    return this.registry.getProvidersByCapability(capability)
  }

  /**
   * Get a provider (without configuration, for backward compatibility)
   * @deprecated Use getConfiguredProvider instead
   */
  getProvider(name: string): BaseProvider | undefined {
    return this.registry.getProvider(name)
  }

  /**
   * Get the active provider (backward compatible)
   * @deprecated Use getActiveChatProvider instead
   */
  async getActiveProvider(): Promise<BaseProvider | null> {
    return this.getActiveChatProvider()
  }

  /**
   * Get the embedding provider (backward compatible)
   * @deprecated Use getActiveEmbeddingProvider instead
   */
  async getEmbeddingProvider(): Promise<BaseProvider | null> {
    return this.getActiveEmbeddingProvider()
  }
}
