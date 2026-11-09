import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type MachineInfo = {
  cpuCores: number
  cpuThreads: number
  ramMB: number
  gpuName: string
  gpuVendor: 'NVIDIA' | 'AMD' | 'Intel' | 'Unknown'
  gpuType: 'Discrete' | 'Onboard' | 'Unknown'
  gpuVramMB: number
  hasDGPU: boolean
}

function safeNum(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Detect CPU/RAM/GPU without blocking the main process. PowerShell can take a
 * second or two on a cold Windows boot; this must never run synchronously
 * before the window is visible.
 */
export async function detectMachineInfo(): Promise<MachineInfo> {
  if (process.platform !== 'win32') {
    return {
      cpuCores: 4,
      cpuThreads: 4,
      ramMB: 0,
      gpuName: 'UNKNOWN',
      gpuVendor: 'Unknown',
      gpuType: 'Unknown',
      gpuVramMB: 0,
      hasDGPU: false
    }
  }

  const ps = [
    "$ErrorActionPreference='SilentlyContinue';",
    '$cs = Get-CimInstance Win32_ComputerSystem;',
    '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1;',
    '$ramMB = [math]::Round([double]$cs.TotalPhysicalMemory/1MB);',
    '$gpus = Get-CimInstance Win32_VideoController;',
    "function Get-GpuVendor([string]$name){ if($name -match 'NVIDIA'){ 'NVIDIA' } elseif($name -match 'AMD|Radeon'){ 'AMD' } elseif($name -match 'Intel'){ 'Intel' } else { 'Unknown' } }",
    "function Get-GpuType([string]$name){ if($name -match 'Intel\\(R\\).*UHD|Intel\\(R\\).*HD|Intel\\(R\\).*Iris'){ 'Onboard' } else { 'Discrete' } }",
    '$best = $null;',
    'if($gpus){ $best = $gpus | Sort-Object @{e={ if($_.AdapterRAM){[double]$_.AdapterRAM}else{0} } } -Descending | Select-Object -First 1 }',
    "$gpuName = if($best){ $best.Name } else { 'NONE' };",
    "$vendor  = if($best){ Get-GpuVendor $best.Name } else { 'Unknown' };",
    "$type    = if($best){ Get-GpuType $best.Name } else { 'Unknown' };",
    '$vramMB  = 0;',
    '$wmi = Get-CimInstance -Namespace root\\wmi -ClassName MSFT_VideoAdapter -ErrorAction SilentlyContinue | Sort-Object DedicatedVideoMemory -Descending | Select-Object -First 1;',
    'if($wmi -and $wmi.DedicatedVideoMemory){ $vramMB = [math]::Round([double]$wmi.DedicatedVideoMemory/1MB) } elseif($best -and $best.AdapterRAM){ $vramMB = [math]::Round([double]$best.AdapterRAM/1MB) }',
    "$hasDGPU = 0; if($best){ if( (Get-GpuType $best.Name) -eq 'Discrete' -and (Get-GpuVendor $best.Name) -ne 'Intel' ){ $hasDGPU = 1 } }",
    "Write-Output ($cpu.NumberOfCores.ToString() + '|' + $cpu.NumberOfLogicalProcessors.ToString() + '|' + $ramMB.ToString() + '|' + $gpuName + '|' + $vendor + '|' + $type + '|' + $vramMB.ToString() + '|' + $hasDGPU.ToString())"
  ].join(' ')

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }
    )
    const line = String(stdout || '').trim().split(/\r?\n/).pop() || ''
    const parts = line.split('|')

    return {
      cpuCores: safeNum(parts[0] || '0', 4),
      cpuThreads: safeNum(
        parts[1] || '0',
        safeNum(String(process.env.NUMBER_OF_PROCESSORS || ''), 4)
      ),
      ramMB: safeNum(parts[2] || '0', 0),
      gpuName: (parts[3] || 'NONE').trim() || 'NONE',
      gpuVendor: ((parts[4] || 'Unknown').trim() as MachineInfo['gpuVendor']) || 'Unknown',
      gpuType: ((parts[5] || 'Unknown').trim() as MachineInfo['gpuType']) || 'Unknown',
      gpuVramMB: safeNum(parts[6] || '0', 0),
      hasDGPU: (parts[7] || '0').trim() === '1'
    }
  } catch {
    return {
      cpuCores: 4,
      cpuThreads: safeNum(String(process.env.NUMBER_OF_PROCESSORS || ''), 4),
      ramMB: 0,
      gpuName: 'UNKNOWN',
      gpuVendor: 'Unknown',
      gpuType: 'Unknown',
      gpuVramMB: 0,
      hasDGPU: false
    }
  }
}
