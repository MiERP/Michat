import { describe, expect, it } from 'vitest'
import { EmbeddingService } from '../../src/main/services/EmbeddingService'

class OversizedInputProvider {
  public calls: string[] = []

  async getActiveEmbeddingProvider() {
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

describe('EmbeddingService adaptive splitting', () => {
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
})
