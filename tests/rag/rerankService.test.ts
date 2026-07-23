import { describe, expect, it } from 'vitest'
import { RerankService } from '../../src/main/services/RerankService'

describe('RerankService', () => {
  it('falls back within the deadline when provider rerank hangs', async () => {
    const providerManager = {
      getActiveRerankProvider: async () => ({ rerank: () => new Promise(() => undefined) })
    }
    const startedAt = performance.now()
    const result = await new RerankService(providerManager as never).rerank(
      'mức phạt doanh nghiệp',
      [
        { id: 'a', text: 'Quyền của doanh nghiệp', baseScore: 0.4 },
        { id: 'b', text: 'Doanh nghiệp bị phạt tiền', baseScore: 0.3 }
      ],
      { enabled: true, timeoutMs: 25 }
    )

    expect(result.method).toBe('heuristic')
    expect(result.orderedIds[0]).toBe('b')
    expect(performance.now() - startedAt).toBeLessThan(150)
  })
})
