/**
 * Models index
 * No hardcoded cloud model lists — models come from llama.cpp server at runtime.
 */

import { Model } from '../../types'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getBuiltinModels(_providerName: string): Model[] {
  return []
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function hasBuiltinModels(_providerName: string): boolean {
  return false
}

export function getAllBuiltinModels(): Record<string, Model[]> {
  return {}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getBuiltinModelsByType(_providerName: string, _type: string): Model[] {
  return []
}

export function getBuiltinModelsStats(): {
  totalProviders: number
  totalModels: number
  byProvider: Record<string, number>
  byType: Record<string, number>
} {
  return { totalProviders: 0, totalModels: 0, byProvider: {}, byType: {} }
}

export * from './types'
