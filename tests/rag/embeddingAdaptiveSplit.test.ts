import { describe, expect, it } from 'vitest'
import { EmbeddingService } from '../../src/main/services/EmbeddingService'
import type { EmbeddingResult } from '../../src/main/ai/types'

class OversizedInputProvider {
  public calls: string[] = []

  async getEmbeddingSignature(): Promise<string> {
    return 'fake-embedding@http://127.0.0.1:8081/v1'
  }

  async getEmbeddingProvider() {
    const make = async (text: string) => {
      this.calls.push(text)
      if (text.length > 1200) {
        throw new Error(
          'input (780 tokens) is too large to process. increase the physical batch size (current batch size: 256)'
        )
      }
      return {
        embedding: new Float32Array(1024),
        model: 'fake-embedding',
        dimensions: 1024,
        tokensUsed: text.length
      }
    }

    return {
      name: 'fake',
      getDefaultEmbeddingModel: () => 'fake-embedding',
      createEmbedding: make,
      createEmbeddings: async (texts: string[]) => Promise.all(texts.map(make))
    }
  }
}

class SignedProvider {
  public calls = 0
  public signature = 'model@http://127.0.0.1:8080/v1'

  async getEmbeddingSignature(): Promise<string> {
    return this.signature
  }

  async getEmbeddingProvider() {
    const make = async (text: string): Promise<EmbeddingResult> => {
      this.calls++
      return {
        embedding: new Float32Array(1024),
        model: 'model',
        dimensions: 1024,
        tokensUsed: text.length
      }
    }

    return {
      name: 'michat-api',
      getDefaultEmbeddingModel: () => 'model',
      createEmbedding: make,
      createEmbeddings: async (texts: string[]) => Promise.all(texts.map(make))
    }
  }
}

describe('EmbeddingService adaptive splitting', () => {
  it('reuses cached embeddings for repeated batches under the same signature', async () => {
    const provider = new SignedProvider()
    const service = new EmbeddingService(provider as never)

    await service.embedBatch(['same batch text'])
    await service.embedBatch(['same batch text'])

    // Regression: the batch path used to write cache entries under the
    // provider name while reads used the model@endpoint signature, so every
    // repeated batch was embedded again.
    expect(provider.calls).toBe(1)
    expect(service.getCacheStats()).toMatchObject({ entries: 1, hits: 1 })
  })

  it('splits an oversized document text instead of failing the batch', async () => {
    const providerManager = new OversizedInputProvider()
    const service = new EmbeddingService(providerManager as never)

    const [result] = await service.embedBatch(['nội dung tài liệu rất dài '.repeat(120)], {
      dimensions: 1024
    })

    expect(result.dimensions).toBe(1024)
    // The initial batch attempt may be oversized; every retried piece must fit.
    const oversized = providerManager.calls.filter((text) => text.length > 1200)
    expect(oversized.length).toBeLessThanOrEqual(1)
    expect(providerManager.calls.length).toBeGreaterThan(1)
  })

  it('drops cached embeddings when the cache is cleared', async () => {
    const providerManager = new OversizedInputProvider()
    const service = new EmbeddingService(providerManager as never)

    await service.embed('same query text')
    await service.embed('same query text')
    expect(providerManager.calls).toHaveLength(1)
    expect(service.getCacheStats()).toMatchObject({ entries: 1, hits: 1 })

    service.clearCache()

    expect(service.getCacheStats()).toMatchObject({ entries: 0 })
    await service.embed('same query text')
    expect(providerManager.calls).toHaveLength(2)
  })

  it('re-probes dimensions after the embedding cache is cleared', async () => {
    const providerManager = new OversizedInputProvider()
    const service = new EmbeddingService(providerManager as never)

    expect(await service.probeDimensions()).toBe(1024)
    expect(providerManager.calls).toHaveLength(1)

    expect(await service.probeDimensions()).toBe(1024)
    expect(providerManager.calls).toHaveLength(1)

    service.clearCache()

    expect(await service.probeDimensions()).toBe(1024)
    expect(providerManager.calls).toHaveLength(2)
  })

  it('reuses batch cache entries under the signature scope', async () => {
    const providerManager = new OversizedInputProvider()
    const service = new EmbeddingService(providerManager as never)
    const texts = ['short one', 'short two']

    await service.embedBatch(texts, { dimensions: 1024 })
    const callsAfterFirstBatch = providerManager.calls.length

    const second = await service.embedBatch(texts, { dimensions: 1024 })

    expect(second.map((result) => result.dimensions)).toEqual([1024, 1024])
    expect(providerManager.calls.length).toBe(callsAfterFirstBatch)
  })
})
