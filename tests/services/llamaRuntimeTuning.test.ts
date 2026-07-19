import { describe, expect, it } from 'vitest'
import { getGemma4CpuTuning } from '../../src/main/services/llamaRuntimeTuning'

describe('Gemma4 CPU runtime tuning', () => {
  it('uses measured generation and prompt thread counts on high-core machines', () => {
    expect(getGemma4CpuTuning({ cpuCores: 18, cpuThreads: 36, ramMB: 65_440 }, 2_950)).toEqual({
      generationThreads: 16,
      batchThreads: 24,
      batchSize: 1024,
      ubatchSize: 512,
      lockMemory: true
    })
  })

  it('keeps conservative batch and memory settings on low-memory machines', () => {
    expect(getGemma4CpuTuning({ cpuCores: 4, cpuThreads: 8, ramMB: 8192 }, 2_950)).toEqual({
      generationThreads: 4,
      batchThreads: 8,
      batchSize: 512,
      ubatchSize: 256,
      lockMemory: false
    })
  })
})
