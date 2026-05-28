import type { ProviderDescriptor } from './registry/ProviderDescriptor'
import type { ProviderConfig } from '../config/types'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function isLocalProviderDescriptor(descriptor: ProviderDescriptor): boolean {
  if (descriptor.locality) return descriptor.locality === 'local'
  return isLocalBaseUrl(descriptor.defaultBaseUrl)
}

export function isLocalProviderConfig(config: ProviderConfig | null | undefined): boolean {
  if (!config) return false
  const baseUrl = config.config.baseUrl
  const embeddingBaseUrl = config.config.embeddingBaseUrl
  return isLocalBaseUrl(baseUrl) && (!embeddingBaseUrl || isLocalBaseUrl(embeddingBaseUrl))
}

export function canUseProviderForLocalFirst(
  descriptor: ProviderDescriptor,
  config: ProviderConfig,
  allowRemoteProviders: boolean
): boolean {
  if (allowRemoteProviders) return true
  return isLocalProviderDescriptor(descriptor) && isLocalProviderConfig(config)
}

function isLocalBaseUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOCAL_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}