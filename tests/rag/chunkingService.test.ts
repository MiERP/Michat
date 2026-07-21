import { describe, expect, it } from 'vitest'
import { ChunkingService } from '../../src/main/services/ChunkingService'

describe('ChunkingService', () => {
  it('does not emit overlap-only tail chunks after a complete short section', () => {
    const chunkingService = new ChunkingService()
    const chunks = chunkingService.chunk('Điều 1. Phạm vi điều chỉnh.', {
      chunkSize: 300,
      chunkOverlap: 30,
      minChunkSize: 1
    })

    expect(chunks).toHaveLength(1)
  })
})
