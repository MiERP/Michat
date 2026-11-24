/**
 * Shared type definitions
 * Based on the Drizzle database schema to keep a single source of truth
 */

// Export knowledge base types
export * from './knowledge'
export * from './retrieval'

// Export chat types
export * from './chat'

// Export Result error handling types
export * from './result'

// Export quiz types
export * from './quiz'

/**
 * Notebook interface
 * Compatible with types inferred from the Drizzle schema
 */
export interface Notebook {
  id: string
  title: string
  description?: string | null | undefined // Compatible with optional fields inferred by Drizzle
  createdAt: Date
  updatedAt: Date
}

/**
 * Note interface
 * Compatible with types inferred from the Drizzle schema
 */
export interface Note {
  id: string
  notebookId: string
  title: string
  content: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Provider configuration interface
 */
export interface ProviderConfig {
  providerName: string
  config: Record<string, unknown>
  enabled: boolean
  updatedAt: number
}

/** Renderer-safe provider view: never contains the stored API key. */
export interface PublicProviderConfig {
  providerName: string
  config: Record<string, unknown>
  enabled: boolean
  updatedAt: number
  hasApiKey: boolean
}

/**
 * Model type enum
 */
export enum ModelType {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  RERANKER = 'reranker',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  UNKNOWN = 'unknown'
}

/**
 * Model interface
 */
export interface Model {
  id: string
  object: string
  owned_by?: string
  created?: number
  type?: ModelType
  max_context?: number // Maximum context length (from built-in configuration)
  description?: string // Model description (from built-in configuration)
}

/**
 * Categorized model list interface
 */
export interface CategorizedModels {
  chat: Model[]
  embedding: Model[]
  reranker: Model[]
  other: Model[]
}

/**
 * Application settings interface
 */
export interface AppSettings {
  theme: 'light' | 'dark'
  language: 'vi-VN' | 'en-US'
  autoLaunch: boolean
  hasCompletedOnboarding: boolean
  defaultChatModel?: string // Default chat model
  defaultEmbeddingModel?: string // Default embedding model
  rerankEnabled?: boolean
  rerankTopN?: number
  rerankUseHeuristicFallback?: boolean
  ragTopK?: number
  ragThreshold?: number
  ragSkipShortQueryLength?: number
  ragEnableChitChatHeuristic?: boolean
  /** Bật tầng chọn tài liệu của Hierarchical Retrieval (doc-level index). */
  ragHierarchicalEnabled?: boolean
  /** Số tài liệu lấy ở tầng chọn tài liệu. */
  ragDocTopK?: number
  /** Bật metadata-aware planning và safe preferred→broad fallback cho RAG. */
  ragMetadataAwareEnabled?: boolean
  /** Chỉ bật log trace truy hồi chi tiết để chẩn đoán. */
  ragRetrievalDebugEnabled?: boolean
  prompts?: {
    quiz?: {
      'vi-VN'?: string // Quiz generation prompt (Vietnamese)
      'en-US'?: string // Quiz generation prompt (English)
    }
    chat?: {
      'vi-VN'?: string
      'en-US'?: string
    }
  }
}

/**
 * Shortcut action enum
 */
export enum ShortcutAction {
  // Notebook management
  CREATE_NOTEBOOK = 'create_notebook',
  CLOSE_NOTEBOOK = 'close_notebook',

  // Panel switching
  TOGGLE_KNOWLEDGE_BASE = 'toggle_knowledge_base', // Knowledge base
  TOGGLE_CREATIVE_SPACE = 'toggle_creative_space' // Creative space
}

/**
 * Shortcut configuration interface
 */
export interface ShortcutConfig {
  action: ShortcutAction
  accelerator: string // e.g. "CommandOrControl+N"
  enabled: boolean
  description: string // i18n key
}
