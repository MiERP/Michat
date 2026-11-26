import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../src/main/ai/apiClient'
import type { ApiConfigManager } from '../src/main/ai/apiConfigManager'

function managerWith(overrides: Record<string, unknown> = {}): ApiConfigManager {
  return {
    getConfig: async () => ({
      baseUrl: 'http://127.0.0.1:1234/v1',
      contextWindow: 8192,
      ...overrides
    }),
    getContextWindowSync: () => 8192
  } as unknown as ApiConfigManager
}

function responseFor(ids: string[]) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: ids.map((id) => ({ id })) })
  }
}

type ModelsFetch = (
  url: string,
  init?: RequestInit
) => Promise<{
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<{ data: Array<{ id: string }> }>
}>

function stubModels(ids: string[]) {
  const fetchMock = vi.fn<ModelsFetch>(async () => responseFor(ids))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ApiClient connection test', () => {
  it('reports available models from /models', async () => {
    const fetchMock = stubModels(['chat-model', 'embed-model'])

    const client = new ApiClient(managerWith())
    const result = await client.testConnection()

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['chat-model', 'embed-model'])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('falls back to the models array when data is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [], models: [{ id: 'fallback-model' }] })
      }))
    )

    const result = await new ApiClient(managerWith()).testConnection()

    expect(result.ok).toBe(true)
    expect(result.models).toEqual(['fallback-model'])
  })

  it('reports an error when the server advertises no model', async () => {
    stubModels([])

    const result = await new ApiClient(managerWith()).testConnection()

    expect(result.ok).toBe(false)
    expect(result.models).toEqual([])
    expect(result.message).toMatch(/no model|load a model/i)
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

  it('returns no provider when the server advertises no model', async () => {
    stubModels([])

    const client = new ApiClient(managerWith())
    expect(await client.getChatProvider()).toBeNull()
    expect(await client.getEmbeddingProvider()).toBeNull()
    expect(await client.getEmbeddingSignature()).toBeNull()
  })

  it('returns no provider without contacting the server when the base URL is empty', async () => {
    const fetchMock = stubModels(['server-selected-model'])
    const client = new ApiClient(managerWith({ baseUrl: '' }))

    expect(await client.getChatProvider()).toBeNull()
    expect(await client.getEmbeddingProvider()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns no provider when model discovery fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused')
      })
    )

    const client = new ApiClient(managerWith())
    expect(await client.getChatProvider()).toBeNull()
    expect(await client.getEmbeddingProvider()).toBeNull()
  })

  it('ignores legacy pinned model ids and uses the advertised model', async () => {
    const fetchMock = stubModels(['server-selected-model'])
    const client = new ApiClient(
      managerWith({ chatModel: 'legacy-chat', embeddingModel: 'legacy-embed' })
    )

    const chat = await client.getChatProvider()
    expect(chat).not.toBeNull()
    // The chat model actually sent to the provider is the discovered one,
    // not the legacy chatModel saved by older versions.
    expect(chat?.getDefaultChatModel()).toBe('server-selected-model')
    expect((chat as unknown as { getAIModel(): unknown }).getAIModel()).toMatchObject({
      modelId: 'server-selected-model'
    })

    const embedding = await client.getEmbeddingProvider()
    expect(embedding?.getDefaultEmbeddingModel()).toBe('server-selected-model')
    expect(await client.getEmbeddingSignature()).toBe(
      'server-selected-model@http://127.0.0.1:1234/v1'
    )
    expect(fetchMock).toHaveBeenCalled()
  })

  it('reads the first usable model id from either payload shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ models: [{ id: '   ' }, { name: 'name-only' }] })
      }))
    )

    const client = new ApiClient(managerWith())
    const chat = await client.getChatProvider()

    expect(chat?.getDefaultChatModel()).toBe('name-only')
    expect(await client.getEmbeddingSignature()).toBe('name-only@http://127.0.0.1:1234/v1')
  })

  it('includes the embedding endpoint in the cache identity', async () => {
    const fetchMock = stubModels(['embed-model'])
    let config: Record<string, unknown> = {
      baseUrl: 'http://127.0.0.1:8080/v1',
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
    // Discovery follows the separate embedding endpoint instead of the chat one.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8080/v1/models',
      'http://127.0.0.1:8081/v1/models'
    ])
  })

  it('auto-discovers the model advertised by the server when none is pinned', async () => {
    const fetchMock = stubModels(['server-selected-model'])
    const client = new ApiClient(managerWith())

    expect(await client.getChatProvider()).not.toBeNull()
    expect(await client.getEmbeddingProvider()).not.toBeNull()
    expect(await client.getEmbeddingSignature()).toBe(
      'server-selected-model@http://127.0.0.1:1234/v1'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({ headers: expect.any(Object) })
    )
    // Chat and embedding discovery are cached separately per capability.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    client.clearCache()
    expect(await client.getChatProvider()).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('selects a chat and an embedding model from a shared gateway', async () => {
    stubModels(['chat-model', 'bge-m3'])
    const client = new ApiClient(managerWith())

    const chat = await client.getChatProvider()
    const embedding = await client.getEmbeddingProvider()

    expect(chat?.getDefaultChatModel()).toBe('chat-model')
    expect(embedding?.getDefaultEmbeddingModel()).toBe('bge-m3')
  })

  it('sends the API key to the loopback model endpoint', async () => {
    const fetchMock = stubModels(['server-selected-model'])
    const client = new ApiClient(managerWith({ apiKey: 'secret-key' }))

    await client.getChatProvider()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
        redirect: 'error'
      })
    )
  })

  it('omits Authorization when no API key is stored', async () => {
    const fetchMock = stubModels(['server-selected-model'])

    await new ApiClient(managerWith()).getChatProvider()

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.headers).not.toHaveProperty('Authorization')
  })

  it('dedupes concurrent model discovery requests', async () => {
    let release!: (value: unknown) => void
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(managerWith())
    const first = client.getChatProvider()
    const second = client.getChatProvider()

    // Concurrent calls for the same capability must join one request.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    release(responseFor(['server-selected-model']))

    const [chat, duplicate] = await Promise.all([first, second])
    expect(chat).not.toBeNull()
    expect(duplicate).toBe(chat)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps a working provider when a later discovery request fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseFor(['server-selected-model']))
      .mockRejectedValueOnce(new Error('temporary failure'))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(managerWith())
    const first = await client.getChatProvider()
    expect(first).not.toBeNull()

    vi.setSystemTime(Date.now() + 61_000)
    const second = await client.getChatProvider()

    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the last known good model when the server later advertises none', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseFor(['model-a']))
      .mockResolvedValueOnce(responseFor([]))
      .mockResolvedValueOnce(responseFor(['model-b']))
    vi.stubGlobal('fetch', fetchMock)

    const client = new ApiClient(managerWith())
    const first = await client.getChatProvider()
    expect(first).not.toBeNull()

    vi.setSystemTime(Date.now() + 61_000)
    expect(await client.getChatProvider()).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // An empty list is a not-ready server: retry on the short failure TTL,
    // not the full discovery TTL.
    vi.setSystemTime(Date.now() + 16_000)
    const recovered = await client.getChatProvider()
    expect(recovered).not.toBe(first)
    expect(recovered?.getDefaultChatModel()).toBe('model-b')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('treats a non-OK models response as a discovery failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' }))
    )

    const client = new ApiClient(managerWith())

    expect(await client.getChatProvider()).toBeNull()
    expect(await client.getEmbeddingSignature()).toBeNull()
  })

  it('fails closed for a legacy non-loopback embedding endpoint', async () => {
    stubModels(['server-selected-model'])
    const client = new ApiClient(managerWith({ embeddingBaseUrl: 'https://example.com/v1' }))

    await expect(client.getEmbeddingProvider()).rejects.toThrow(/loopback|localhost|127/i)
    // A bad embedding endpoint must not prevent chat from working.
    expect(await client.getChatProvider()).not.toBeNull()
  })

  it('rebuilds the chat provider when the API key changes', async () => {
    stubModels(['server-selected-model'])
    let config: Record<string, unknown> = {
      baseUrl: 'http://127.0.0.1:8080/v1',
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

  it('clearCache drops both cached providers', async () => {
    stubModels(['server-selected-model'])
    const client = new ApiClient(managerWith())

    const chat = await client.getChatProvider()
    const embedding = await client.getEmbeddingProvider()
    client.clearCache()

    expect(await client.getChatProvider()).not.toBe(chat)
    expect(await client.getEmbeddingProvider()).not.toBe(embedding)
  })

  it('reuses a provider until the saved configuration changes', async () => {
    stubModels(['server-selected-model'])
    let config: Record<string, unknown> = {
      baseUrl: 'http://127.0.0.1:8080/v1',
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

    config = { ...config, baseUrl: 'http://127.0.0.1:8081/v1' }
    const third = await client.getChatProvider()
    expect(third).not.toBe(first)

    client.clearCache()
    const fourth = await client.getChatProvider()
    expect(fourth).not.toBe(third)
  })

  it('rejects a legacy non-loopback embedding endpoint instead of degrading silently', async () => {
    // A hand-edited or legacy embeddingBaseUrl must fail closed: the provider
    // and its signature both throw so maintenance flows report the bad config
    // instead of mixing vectors from an unreachable endpoint.
    stubModels(['server-selected-model'])
    const client = new ApiClient(managerWith({ embeddingBaseUrl: 'http://10.0.0.5:8081/v1' }))

    await expect(client.getEmbeddingProvider()).rejects.toThrow(
      'Embedding API base URL must point to localhost or 127.0.0.1'
    )
    await expect(client.getEmbeddingSignature()).rejects.toThrow(
      'Embedding API base URL must point to localhost or 127.0.0.1'
    )
  })

  it('refuses to embed with a chat model when the gateway has several models and none embeds', async () => {
    // A multi-model gateway without an embedding-like id must not get a
    // silent chat-model embedding fallback; chat still uses the first id.
    stubModels(['chat-a', 'chat-b'])
    const client = new ApiClient(managerWith())

    const chat = await client.getChatProvider()
    expect(chat).not.toBeNull()
    expect(await client.getEmbeddingProvider()).toBeNull()
    expect(await client.getEmbeddingSignature()).toBeNull()
  })
})
