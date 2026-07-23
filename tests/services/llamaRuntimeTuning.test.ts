import { describe, expect, it } from 'vitest'
import {
  getGemma4CpuTuning,
  hasGpuBackendLibrary
} from '../../src/main/services/llamaRuntimeTuning'

describe('Gemma4 CPU runtime tuning', () => {
  it('reserves CPU capacity for the desktop on high-core machines', () => {
    expect(getGemma4CpuTuning({ cpuCores: 18, cpuThreads: 36, ramMB: 65_440 }, 2_950)).toEqual({
      generationThreads: 8,
      batchThreads: 8,
      batchSize: 512,
      ubatchSize: 256,
      lockMemory: true
    })
  })

  it('keeps conservative batch and memory settings on low-memory machines', () => {
    expect(getGemma4CpuTuning({ cpuCores: 4, cpuThreads: 8, ramMB: 8192 }, 2_950)).toEqual({
      generationThreads: 4,
      batchThreads: 4,
      batchSize: 512,
      ubatchSize: 256,
      lockMemory: false
    })
  })

  it('only enables GPU offload when the llama build includes a GPU backend', () => {
    expect(hasGpuBackendLibrary(['ggml.dll', 'ggml-base.dll', 'ggml-cpu-x64.dll'])).toBe(false)
    expect(hasGpuBackendLibrary(['ggml.dll', 'ggml-vulkan.dll'])).toBe(true)
  })
})
