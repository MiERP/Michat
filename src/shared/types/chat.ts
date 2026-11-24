/**
 * Unified chat-related type definitions
 * Shared by the main, renderer, and preload processes
 *
 * Types are derived from the Drizzle database schema to keep a single source of truth
 */

import type {
  ChatSession as DBChatSession,
  ChatMessage as DBChatMessage
} from '../../main/db/schema'

/**
 * Chat session interface (full version)
 * Uses the database types inferred by Drizzle directly
 */
export type ChatSession = DBChatSession

export interface ChatCitation {
  index: number
  documentId: string
  documentTitle: string
  chunkId: string
  chunkIndex: number
  score: number
  snippet: string
  sourceUri?: string
  pageNumber?: number
  /** Đường dẫn mục (heading) mà chunk được neo vào — để citation chỉ đúng mục. */
  sectionPath?: string[]
}

/**
 * Phạm vi tri thức cho một lượt hỏi (Metadata-Aware Retrieval).
 * Người dùng chọn: đúng tài liệu → đúng mục → đúng khoảng trang.
 */
export interface ChatScope {
  documentIds?: string[]
  sectionPath?: string[]
  pageRange?: { from: number; to: number }
}

export interface ChatMessageMetadata {
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  model?: string
  finishReason?: string
  citations?: ChatCitation[]
}

/**
 * Chat message interface (full version)
 * Based on the Drizzle-inferred database type, plus frontend extension fields
 */
export interface ChatMessage extends Omit<DBChatMessage, 'metadata' | 'reasoningContent'> {
  notebookId?: string // Frontend extension field for managing concurrent messages
  reasoningContent?: string | null // Optional reasoning content field
  metadata?: ChatMessageMetadata
  isStreaming?: boolean // Frontend extension field marking a streaming message
  isReasoningStreaming?: boolean // Frontend extension field indicating whether reasoning is streaming
}

/**
 * API message format (used to communicate with LLM providers)
 * Simplified version containing only the fields the API needs
 */
export interface APIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning_content?: string // DeepSeek Reasoner-specific field
}

/**
 * Streaming response chunk
 */
/** Result of the send-message IPC call. */
export interface SendMessageResult {
  messageId: string
  error?: string
}

/** Emitted as soon as the assistant placeholder row exists. */
export interface ChatMessageCreatedEvent {
  messageId: string
  sessionId: string
  notebookId: string
}

/** Streaming error payload; notebookId lets the renderer clear state without a cache hit. */
export interface ChatMessageErrorEvent {
  messageId: string
  notebookId: string
  error: string
}

export interface StreamChunk {
  content: string
  reasoningContent?: string // DeepSeek Reasoner reasoning content
  done: boolean
  reasoningDone?: boolean // Whether reasoning has finished
  metadata?: {
    model?: string
    finishReason?: string
    usage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
    citations?: ChatCitation[]
    // Reasoning metadata (AI SDK v5 reasoning streaming)
    isReasoning?: boolean // Whether the current content is reasoning
    reasoningStart?: boolean // Reasoning block start marker
    reasoningEnd?: boolean // Reasoning block end marker
    reasoningId?: string // Reasoning block ID
  }
}
