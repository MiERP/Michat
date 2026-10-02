import { describe, expect, it } from 'vitest'
import {
  shouldOffloadChatModelToGpu,
  type GpuInfo
} from '../src/main/services/llama/runtimeProfile'

const machine: GpuInfo = {
  gpuVendor: 'AMD',
  gpuVramMB: 4095,
  hasDGPU: true
}

describe('shouldOffloadChatModelToGpu', () => {
  it('uses CPU when model leaves less than 2GB VRAM headroom', () => {
    expect(shouldOffloadChatModelToGpu(machine, 2948)).toBe(false)
  })

  it('uses GPU when VRAM has enough model headroom', () => {
    expect(shouldOffloadChatModelToGpu({ ...machine, gpuVramMB: 8192 }, 2948)).toBe(true)
  })

  it('does not offload to integrated or unsupported GPUs', () => {
    expect(
      shouldOffloadChatModelToGpu({ ...machine, gpuVendor: 'Intel', hasDGPU: false }, 2948)
    ).toBe(false)
  })
})
