import type { AppSettings, Model, ShortcutConfig } from '../../shared/types'

/**
 * Provider configuration interface
 */
export interface ProviderConfig {
  providerName: string
  config: Record<string, unknown>
  enabled: boolean
  updatedAt: number
}

/**
 * Cached model list stored per provider
 */
export interface ProviderModelEntry {
  models: Model[]
}

/**
 * Store schema definition
 */
export interface StoreSchema {
  settings: AppSettings
  providers: Record<string, ProviderConfig>
  shortcuts: ShortcutConfig[]
  models?: Record<string, ProviderModelEntry>
}

// Re-export AppSettings for backward compatibility
export type { AppSettings }
