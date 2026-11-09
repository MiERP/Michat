import { describe, expect, it } from 'vitest'
import {
  canUseProviderForLocalFirst,
  isLocalProviderConfig,
  isLocalProviderDescriptor
} from '../src/main/providers/providerPolicy'
import type { ProviderConfig } from '../src/main/config/types'
import type { ProviderDescriptor } from '../src/main/providers/registry/ProviderDescriptor'

function descriptor(overrides: Partial<ProviderDescriptor> = {}): ProviderDescriptor {
  return {
    name: 'test',
    displayName: 'Test',
    isBuiltin: true,
    locality: 'local',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    capabilities: { chat: true, embedding: true },
    createProvider: (() => ({})) as ProviderDescriptor['createProvider'],
    ...overrides
  }
}

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    providerName: 'test',
    enabled: true,
    updatedAt: 0,
    config: { baseUrl: 'http://127.0.0.1:8000/v1' },
    ...overrides
  }
}

describe('providerPolicy', () => {
  it('allows local builtin providers by default', () => {
    expect(isLocalProviderDescriptor(descriptor())).toBe(true)
    expect(isLocalProviderConfig(config())).toBe(true)
    expect(canUseProviderForLocalFirst(descriptor(), config())).toBe(true)
  })

  it('blocks remote endpoints unconditionally', () => {
    const remoteDescriptor = descriptor({
      locality: 'remote',
      defaultBaseUrl: 'https://api.example.com/v1'
    })
    const remoteConfig = config({ config: { baseUrl: 'https://api.example.com/v1' } })

    expect(canUseProviderForLocalFirst(remoteDescriptor, remoteConfig)).toBe(false)
  })

  it('blocks mixed local chat and remote embedding endpoints', () => {
    const mixedConfig = config({
      config: {
        baseUrl: 'http://127.0.0.1:8000/v1',
        embeddingBaseUrl: 'https://api.example.com/v1'
      }
    })

    expect(isLocalProviderConfig(mixedConfig)).toBe(false)
    expect(canUseProviderForLocalFirst(descriptor(), mixedConfig)).toBe(false)
  })
})
