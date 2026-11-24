/**
 * Provider Registry
 * Provider registry that manages all registered provider descriptors and instances
 */

import type { BaseProvider } from '../capabilities/BaseProvider'
import type { ProviderDescriptor } from './ProviderDescriptor'
import Logger from '../../../shared/utils/logger'

/**
 * ProviderRegistry
 * Registry that manages provider descriptors and instances
 */
export class ProviderRegistry {
  // Provider descriptor map (name -> descriptor)
  private descriptors: Map<string, ProviderDescriptor> = new Map()

  // Provider instance cache (name -> instance)
  private instances: Map<string, BaseProvider> = new Map()

  constructor() {
    Logger.info('ProviderRegistry', 'Provider registry initialized')
  }

  /**
   * Register a provider descriptor
   * @param descriptor - Provider descriptor
   */
  register(descriptor: ProviderDescriptor): void {
    if (this.descriptors.has(descriptor.name)) {
      Logger.warn(
        'ProviderRegistry',
        `Provider ${descriptor.name} already registered, will be overwritten`
      )
    }

    this.descriptors.set(descriptor.name, descriptor)
    // Clear the old instance cache (if any)
    this.instances.delete(descriptor.name)

    Logger.info('ProviderRegistry', `Registered provider: ${descriptor.name}`)
  }

  /**
   * Register multiple provider descriptors
   * @param descriptors - Array of provider descriptors
   */
  registerMany(descriptors: ProviderDescriptor[]): void {
    descriptors.forEach((descriptor) => this.register(descriptor))
  }

  /**
   * Get a provider instance (created lazily)
   * @param name - Provider name
   * @returns Provider instance or undefined
   */
  getProvider(name: string): BaseProvider | undefined {
    // Check the cache first
    if (this.instances.has(name)) {
      return this.instances.get(name)
    }

    // No cached instance, create one from the descriptor
    const descriptor = this.descriptors.get(name)
    if (!descriptor) {
      Logger.warn('ProviderRegistry', `Provider ${name} not registered`)
      return undefined
    }

    try {
      const instance = descriptor.createProvider(descriptor)
      this.instances.set(name, instance)
      Logger.info('ProviderRegistry', `Created instance for provider: ${name}`)
      return instance
    } catch (error) {
      Logger.error('ProviderRegistry', `Failed to create provider ${name}:`, error)
      return undefined
    }
  }

  /**
   * Get a provider descriptor
   * @param name - Provider name
   * @returns ProviderDescriptor or undefined
   */
  getDescriptor(name: string): ProviderDescriptor | undefined {
    return this.descriptors.get(name)
  }

  /**
   * List all registered provider descriptors
   * @returns ProviderDescriptor array
   */
  listDescriptors(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values())
  }

  /**
   * List all registered provider names
   * @returns Provider name array
   */
  listProviderNames(): string[] {
    return Array.from(this.descriptors.keys())
  }

  /**
   * Query providers by capability
   * @param capability - Capability name ('chat' | 'embedding')
   * @returns Provider descriptors that support the capability
   */
  getProvidersByCapability(capability: 'chat' | 'embedding'): ProviderDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => {
      return descriptor.capabilities[capability] === true
    })
  }

  /**
   * Get the list of built-in providers
   * @returns Built-in provider descriptor array
   */
  getBuiltinProviders(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => descriptor.isBuiltin)
  }

  /**
   * Get the list of custom providers
   * @returns Custom provider descriptor array
   */
  getCustomProviders(): ProviderDescriptor[] {
    return Array.from(this.descriptors.values()).filter((descriptor) => !descriptor.isBuiltin)
  }

  /**
   * Check whether a provider is registered
   * @param name - Provider name
   * @returns Whether it is registered
   */
  has(name: string): boolean {
    return this.descriptors.has(name)
  }

  /**
   * Remove a provider
   * @param name - Provider name
   */
  unregister(name: string): void {
    this.descriptors.delete(name)
    this.instances.delete(name)
    Logger.info('ProviderRegistry', `Unregistered provider: ${name}`)
  }

  /**
   * Clear all instance caches
   * Used to force recreation of all instances
   */
  clearInstanceCache(): void {
    this.instances.clear()
    Logger.info('ProviderRegistry', 'Cleared all provider instances')
  }
}
