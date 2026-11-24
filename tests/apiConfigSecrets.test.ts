import { describe, expect, it, vi } from 'vitest'
import { ApiConfigManager } from '../src/main/ai/apiConfigManager'

vi.mock('../src/main/config/secureStorage', () => ({
  encryptObjectFields: (config: Record<string, unknown>) => {
    const apiKey = config.apiKey
    return apiKey
      ? { ...config, apiKey: `enc:${String(apiKey)}`, __encrypted_apiKey: true }
      : { ...config }
  },
  decryptObjectFields: (config: Record<string, unknown>) => {
    const apiKey = config.apiKey
    return typeof apiKey === 'string' && apiKey.startsWith('enc:')
      ? { ...config, apiKey: apiKey.slice(4) }
      : { ...config }
  },
  isEncryptionAvailable: () => true
}))

function createManager(): { manager: ApiConfigManager; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  const store = {
    get: (key: string, fallback: unknown) => data[key] ?? fallback,
    set: (key: string, value: unknown) => {
      data[key] = value
    }
  }
  return { manager: new ApiConfigManager(async () => store as never), data }
}

describe('ApiConfigManager secret handling', () => {
  it('never exposes the decrypted API key through the public view', async () => {
    const { manager } = createManager()

    await manager.saveConfig({
      baseUrl: 'http://127.0.0.1:1234/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      apiKey: 'sk-test-secret'
    })

    const publicConfig = await manager.getPublicConfig()
    expect(publicConfig.hasApiKey).toBe(true)
    expect(JSON.stringify(publicConfig)).not.toContain('sk-test-secret')

    const internal = await manager.getConfig()
    expect(internal.apiKey).toBe('sk-test-secret')
  })

  it('keeps the existing key when the renderer saves without a new key', async () => {
    const { manager } = createManager()
    await manager.saveConfig({
      baseUrl: 'http://127.0.0.1:1234/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      apiKey: 'sk-test-secret'
    })

    await manager.saveConfig({ baseUrl: 'http://127.0.0.1:4321/v1' })

    const internal = await manager.getConfig()
    expect(internal.apiKey).toBe('sk-test-secret')
    expect(internal.baseUrl).toBe('http://127.0.0.1:4321/v1')
  })

  it('clears the key only when explicitly requested', async () => {
    const { manager } = createManager()
    await manager.saveConfig({
      baseUrl: 'http://127.0.0.1:1234/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      apiKey: 'sk-test-secret'
    })

    await manager.saveConfig({ baseUrl: 'http://127.0.0.1:1234/v1', clearApiKey: true })

    const internal = await manager.getConfig()
    expect(internal.apiKey).toBeUndefined()
    const publicConfig = await manager.getPublicConfig()
    expect(publicConfig.hasApiKey).toBe(false)
  })

  it('rejects non-loopback API URLs', async () => {
    const { manager } = createManager()
    await expect(manager.saveConfig({ baseUrl: 'https://example.com/v1' })).rejects.toThrow()
  })
})
