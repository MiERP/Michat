import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../src/main/ai/apiClient'
import type { ApiConfigManager } from '../src/main/ai/apiConfigManager'

function managerWith(overrides: Record<string, unknown> = {}): ApiConfigManager {
  return {
    getConfig: async () => ({
      baseUrl: 'http://127.0.0.1:1234/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      contextWindow: 8192,
      ...overrides
    }),
    getContextWindowSync: () => 8192
  } as unknown as ApiConfigManager
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiClient connection test', () => {
  it('reports available models from /models', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [{ id: 'chat-model' }, { id: 'embed-model' }] })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(managerWith())
    const result = await client.testConnection()

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['chat-model', 'embed-model'])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns a failure for HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' }))
    )

    const result = await new ApiClient(managerWith()).testConnection()

    expect(result.ok).toBe(false)
    expect(result.status).toBe(500)
  })

  it('rejects non-loopback endpoints', async () => {
    const result = await new ApiClient(
      managerWith({ baseUrl: 'https://example.com/v1' })
    ).testConnection()

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/loopback|localhost|127/i)
  })

  it('does not return chat/embedding clients when models are missing', async () => {
    const client = new ApiClient(managerWith({ chatModel: '', embeddingModel: '' }))
    expect(await client.getChatProvider()).toBeNull()
    expect(await client.getEmbeddingProvider()).toBeNull()
  })

  it('includes the embedding endpoint in the cache identity', async () => {
    let config: Record<string, unknown> = {
      baseUrl: 'http://127.0.0.1:8080/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      contextWindow: 8192
    }
    const manager = {
      getConfig: async () => config,
      getContextWindowSync: () => 8192
    } as unknown as ApiConfigManager
    const client = new ApiClient(manager)

    const first = await client.getEmbeddingProvider()
    const second = await client.getEmbeddingProvider()
    expect(second).toBe(first)

    config = { ...config, embeddingBaseUrl: 'http://127.0.0.1:8081/v1' }
    const third = await client.getEmbeddingProvider()
    expect(third).not.toBe(first)
    expect(await client.getEmbeddingSignature()).toBe('embed-model@http://127.0.0.1:8081/v1')
  })

  it('fails closed for a legacy non-loopback embedding endpoint', async () => {
    const client = new ApiClient(managerWith({ embeddingBaseUrl: 'https://example.com/v1' }))

    await expect(client.getEmbeddingProvider()).rejects.toThrow(/loopback|localhost|127/i)
    // A bad embedding endpoint must not prevent chat from working.
    expect(await client.getChatProvider()).not.toBeNull()
  })

  it('rebuilds the chat provider when the API key changes', async () => {
    let config: Record<string, unknown> = {
      baseUrl: 'http://127.0.0.1:8080/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      contextWindow: 8192,
      apiKey: 'key-a'
    }
    const manager = {
      getConfig: async () => config,
      getContextWindowSync: () => 8192
    } as unknown as ApiConfigManager
    const client = new ApiClient(manager)

    const first = await client.getChatProvider()
    expect(await client.getChatProvider()).toBe(first)

    config = { ...config, apiKey: 'key-b' }
    const rotated = await client.getChatProvider()
    expect(rotated).not.toBe(first)
  })

  it('rebuilds the embedding provider when the embedding model changes', async () => {
    let config: Record<string, unknown> = {
      baseUrl: 'http://127.0.0.1:8080/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model-a',
      contextWindow: 8192
    }
    const manager = {
      getConfig: async () => config,
      getContextWindowSync: () => 8192
    } as unknown as ApiConfigManager
    const client = new ApiClient(manager)

    const first = await client.getEmbeddingProvider()
    expect(await client.getEmbeddingProvider()).toBe(first)

    config = { ...config, embeddingModel: 'embed-model-b' }
    const second = await client.getEmbeddingProvider()
    expect(second).not.toBe(first)
    expect(await client.getEmbeddingSignature()).toBe('embed-model-b@http://127.0.0.1:8080/v1')
  })

  it('clearCache drops both cached providers', async () => {
    const client = new ApiClient(managerWith())

    const chat = await client.getChatProvider()
    const embedding = await client.getEmbeddingProvider()
    client.clearCache()

    expect(await client.getChatProvider()).not.toBe(chat)
    expect(await client.getEmbeddingProvider()).not.toBe(embedding)
  })

  it('reuses a provider until the saved configuration changes', async () => {
    let config = {
      baseUrl: 'http://127.0.0.1:8080/v1',
      chatModel: 'chat-model',
      embeddingModel: 'embed-model',
      contextWindow: 8192
    }
    const manager = {
      getConfig: async () => config,
      getContextWindowSync: () => 8192
    } as unknown as ApiConfigManager
    const client = new ApiClient(manager)

    const first = await client.getChatProvider()
    const second = await client.getChatProvider()
    expect(first).not.toBeNull()
    expect(second).toBe(first)

    config = { ...config, chatModel: 'chat-model-2' }
    const third = await client.getChatProvider()
    expect(third).not.toBe(first)

    client.clearCache()
    const fourth = await client.getChatProvider()
    expect(fourth).not.toBe(third)
  })
})
