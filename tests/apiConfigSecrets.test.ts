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
      apiKey: 'sk-test-secret'
    })

    await manager.saveConfig({ baseUrl: 'http://127.0.0.1:1234/v1', clearApiKey: true })

    const internal = await manager.getConfig()
    expect(internal.apiKey).toBeUndefined()
    const publicConfig = await manager.getPublicConfig()
    expect(publicConfig.hasApiKey).toBe(false)
  })

  it('removes legacy model ids from the persisted store on read', async () => {
    const { manager, data } = createManager()
    data.api = {
      baseUrl: 'http://127.0.0.1:1234/v1',
      chatModel: 'legacy-chat',
      embeddingModel: 'legacy-embed',
      contextWindow: 8192
    }

    const internal = await manager.getConfig()

    expect(internal.chatModel).toBeUndefined()
    expect(internal.embeddingModel).toBeUndefined()
    expect('chatModel' in (data.api as Record<string, unknown>)).toBe(false)
    expect('embeddingModel' in (data.api as Record<string, unknown>)).toBe(false)
  })

  it('rejects non-loopback API URLs', async () => {
    const { manager } = createManager()
    await expect(manager.saveConfig({ baseUrl: 'https://example.com/v1' })).rejects.toThrow()
  })

  it('rejects non-loopback embedding URLs', async () => {
    const { manager } = createManager()
    await expect(
      manager.saveConfig({ embeddingBaseUrl: 'https://example.com/v1' })
    ).rejects.toThrow()
  })

  it('normalizes a loopback embedding URL', async () => {
    const { manager } = createManager()
    await manager.saveConfig({ embeddingBaseUrl: 'http://127.0.0.1:8081/v1/' })

    const internal = await manager.getConfig()
    expect(internal.embeddingBaseUrl).toBe('http://127.0.0.1:8081/v1')
  })

  it('hides legacy model fields read from an old config', async () => {
    const { manager, data } = createManager()
    data.api = {
      baseUrl: 'http://127.0.0.1:1234/v1',
      contextWindow: 8192,
      chatModel: 'legacy-chat',
      embeddingModel: 'legacy-embed'
    }

    const internal = await manager.getConfig()
    expect(internal).not.toHaveProperty('chatModel')
    expect(internal).not.toHaveProperty('embeddingModel')

    // Reading an old config persists the one-time cleanup.
    const migrated = data.api as Record<string, unknown>
    expect(migrated).not.toHaveProperty('chatModel')
    expect(migrated).not.toHaveProperty('embeddingModel')
    expect(migrated.baseUrl).toBe('http://127.0.0.1:1234/v1')

    // The public view never exposes model selection either.
    const publicConfig = await manager.getPublicConfig()
    expect(publicConfig).not.toHaveProperty('chatModel')
    expect(publicConfig).not.toHaveProperty('embeddingModel')
  })

  it('removes legacy model fields from the store when saving', async () => {
    const { manager, data } = createManager()
    data.api = {
      baseUrl: 'http://127.0.0.1:1234/v1',
      contextWindow: 8192,
      chatModel: 'legacy-chat',
      embeddingModel: 'legacy-embed'
    }

    const saved = await manager.saveConfig({ contextWindow: 4096 })

    expect(saved).not.toHaveProperty('chatModel')
    expect(saved).not.toHaveProperty('embeddingModel')

    const persisted = data.api as Record<string, unknown>
    expect(persisted).not.toHaveProperty('chatModel')
    expect(persisted).not.toHaveProperty('embeddingModel')
    expect(persisted.contextWindow).toBe(4096)
    expect(persisted.baseUrl).toBe('http://127.0.0.1:1234/v1')
  })
})
