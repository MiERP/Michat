import { ModelType } from '../../types'

/**
 * Local model definition (simplified, for static configuration)
 */
export interface LocalModelDefinition {
  id: string
  type: ModelType
  owned_by?: string
  max_context?: number // Maximum context length
  description?: string // Model description (optional)
}

/**
 * Provider local model list configuration
 */
export interface ProviderLocalModels {
  providerName: string
  lastUpdated: string // ISO date string, for tracking the update time
  models: LocalModelDefinition[]
}
