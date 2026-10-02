export type GpuInfo = {
  gpuVendor: 'NVIDIA' | 'AMD' | 'Intel' | 'Unknown'
  gpuVramMB: number
  hasDGPU: boolean
}

export function shouldOffloadChatModelToGpu(info: GpuInfo, modelSizeMB: number): boolean {
  if (!info.hasDGPU || (info.gpuVendor !== 'NVIDIA' && info.gpuVendor !== 'AMD')) return false
  if (info.gpuVramMB <= 0 || modelSizeMB <= 0) return true
  return info.gpuVramMB >= modelSizeMB + 2048
}
