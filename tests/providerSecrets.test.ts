import { describe, expect, it, vi } from 'vitest'
import { ProviderConfigManager } from '../src/main/config/ProviderConfigManager'

vi.mock('../src/main/config/secureStorage', () => ({
  encryptProviderConfig: (config: Record<string, unknown>) => {
    const apiKey = config.apiKey
    return apiKey
      ? { ...config, apiKey: `enc:${String(apiKey)}`, __encrypted_apiKey: true }
      : { ...config }
  },
  decryptProviderConfig: (config: Record<string, unknown>) => {
    const apiKey = config.apiKey
    return typeof apiKey === 'string' && apiKey.startsWith('enc:')
      ? { ...config, apiKey: apiKey.slice(4) }
      : { ...config }
  },
  isEncryptionAvailable: () => true
}))

function createManager(): {
  manager: ProviderConfigManager
  data: { providers: Record<string, unknown> }
} {
  const data: { providers: Record<string, unknown> } = { providers: {} }
  const store = {
    get: (key: string, fallback: unknown) => data[key as keyof typeof data] ?? fallback,
    set: (key: string, value: unknown) => {
      data[key as keyof typeof data] = value as never
    }
  }
  return { manager: new ProviderConfigManager(async () => store as never), data }
}

describe('ProviderConfigManager secret handling', () => {
  it('never exposes the decrypted API key through the public view', async () => {
    const { manager } = createManager()

    await manager.saveProviderConfig(
      'llama',
      { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-test-secret' },
      true
    )

    const publicConfig = await manager.getPublicProviderConfig('llama')
    expect(publicConfig?.hasApiKey).toBe(true)
    expect(publicConfig?.config.apiKey).toBeUndefined()
    expect(JSON.stringify(publicConfig)).not.toContain('sk-test-secret')

    const internal = await manager.getProviderConfig('llama')
    expect(internal?.config.apiKey).toBe('sk-test-secret')
  })

  it('keeps the existing key when the renderer saves a redacted config', async () => {
    const { manager } = createManager()
    await manager.saveProviderConfig(
      'llama',
      { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-test-secret' },
      true
    )

    await manager.saveProviderConfig('llama', { baseUrl: 'http://127.0.0.1:8001/v1' }, true)

    const internal = await manager.getProviderConfig('llama')
    expect(internal?.config.apiKey).toBe('sk-test-secret')
    expect(internal?.config.baseUrl).toBe('http://127.0.0.1:8001/v1')
  })

  it('clears the key only when explicitly requested', async () => {
    const { manager } = createManager()
    await manager.saveProviderConfig(
      'llama',
      { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-test-secret' },
      true
    )

    await manager.saveProviderConfig('llama', { baseUrl: 'http://127.0.0.1:8000/v1' }, true, {
      clearApiKey: true
    })

    const internal = await manager.getProviderConfig('llama')
    expect(internal?.config.apiKey).toBeUndefined()
    const publicConfig = await manager.getPublicProviderConfig('llama')
    expect(publicConfig?.hasApiKey).toBe(false)
  })
})
