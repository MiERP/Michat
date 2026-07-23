export interface Gemma4MachineInfo {
  cpuCores: number
  cpuThreads: number
  ramMB: number
}

export interface Gemma4CpuTuning {
  generationThreads: number
  batchThreads: number
  batchSize: number
  ubatchSize: number
  lockMemory: boolean
}

export function hasGpuBackendLibrary(filenames: string[]): boolean {
  return filenames.some((filename) =>
    /^(?:lib)?ggml-(?:cuda|vulkan|hip|sycl|metal)(?:[-_.]|$)/iu.test(filename)
  )
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function getGemma4CpuTuning(
  machine: Gemma4MachineInfo,
  modelSizeMB: number
): Gemma4CpuTuning {
  const logicalThreads = positiveInteger(machine.cpuThreads, 4)
  const physicalCores = Math.min(
    logicalThreads,
    positiveInteger(machine.cpuCores, Math.max(1, Math.ceil(logicalThreads / 2)))
  )
  const generationThreads = Math.min(8, physicalCores)
  const batchThreads = generationThreads
  const lockMemory = machine.ramMB >= Math.max(24_576, Math.max(0, modelSizeMB) * 2 + 8192)

  return {
    generationThreads,
    batchThreads,
    batchSize: 512,
    ubatchSize: 256,
    lockMemory
  }
}
