/**
 * Notebook-related type definitions
 * Re-export all types from the shared module
 */

// Import the shared chat types from shared
export type { ChatSession, ChatMessage, ChatScope } from '../../../shared/types/chat'

// Import notebook and note types from shared
export type { Notebook, Note } from '../../../shared/types'
