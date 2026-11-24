import type { AppSettings, ShortcutConfig } from '../../shared/types'
import type { StoredApiConfig } from '../ai/types'

/**
 * Store schema definition
 */
export interface StoreSchema {
  settings: AppSettings
  shortcuts: ShortcutConfig[]
  api?: StoredApiConfig
}

// Re-export AppSettings for backward compatibility
export type { AppSettings }
