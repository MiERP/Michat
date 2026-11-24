import type {
  ChatSession,
  ChatMessage,
  ChatScope,
  ChatMessageCreatedEvent,
  SendMessageResult,
  StreamChunk
} from '../shared/types/chat'
import type { Notebook, Note, AppSettings, ShortcutAction, ShortcutConfig } from '../shared/types'
import type { PublicApiConfig, SaveApiConfigInput, ApiTestResult } from '../shared/types/api'
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeSearchResult,
  KnowledgeStats,
  AddDocumentOptions,
  SearchOptions,
  IndexProgress
} from '../shared/types/knowledge'
import type { UpdateState, UpdateCheckResult, UpdateOperationResult } from '../shared/types/update'
import type { Quiz, QuizSession } from '../main/db/schema'
import type { ItemDetail } from '../main/services/ItemService'
import type { DocumentMetadata } from '../shared/legalMetadata'
import type { DocumentEnrichment } from '../main/services/DocumentEnrichmentService'

// Re-export shared types
export type {
  ChatSession,
  ChatMessage,
  Notebook,
  Note,
  ProviderConfig,
  AppSettings,
  Quiz,
  QuizSession
}
export type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeSearchResult,
  KnowledgeStats,
  AddDocumentOptions,
  SearchOptions,
  IndexProgress
}
export type { UpdateState, UpdateCheckResult, UpdateOperationResult }

declare global {
  interface Window {
    api: {
      // Get platform information
      getPlatform: () => Promise<string>

      // Get the app version
      getAppVersion: () => Promise<string>

      // Open an external link in the default browser
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

      // App settings
      settings: {
        getAll: () => Promise<AppSettings>
        get: <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>
        update: (updates: Partial<AppSettings>) => Promise<AppSettings>
        set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings[K]>
        reset: () => Promise<AppSettings>
        getDefaultPrompts: () => Promise<AppSettings['prompts']>
        onSettingsChange: (
          callback: (newSettings: AppSettings, oldSettings: AppSettings) => void
        ) => () => void
      }

      // Notebooks
      createNotebook: (title: string, description?: string) => Promise<Notebook>
      getAllNotebooks: () => Promise<Notebook[]>
      getNotebook: (id: string) => Promise<Notebook | null>
      updateNotebook: (
        id: string,
        updates: Partial<Pick<Notebook, 'title' | 'description'>>
      ) => Promise<void>
      deleteNotebook: (id: string) => Promise<void>

      // Notes
      createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
      getNotes: (notebookId: string) => Promise<Note[]>
      getNote: (id: string) => Promise<Note | null>
      updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
      deleteNote: (id: string) => Promise<void>

      // Items (unified management of notes, quizzes, etc.)
      items: {
        getAll: (notebookId: string) => Promise<ItemDetail[]>
        updateOrder: (itemId: string, order: number) => Promise<{ success: boolean }>
        batchUpdateOrder: (updates: Record<string, number>) => Promise<{ success: boolean }>
        delete: (itemId: string, deleteResource?: boolean) => Promise<{ success: boolean }>
      }

      // Quiz
      quiz: {
        getLatest: (notebookId: string) => Promise<Quiz | null>
        get: (quizId: string) => Promise<Quiz | null>
        generate: (
          notebookId: string,
          options?: {
            questionCount?: number
            difficulty?: 'easy' | 'medium' | 'hard'
            customPrompt?: string
            documentIds?: string[]
          }
        ) => Promise<{ success: boolean; quizId?: string; error?: string }>
        submitSession: (
          quizId: string,
          answers: Record<string, number>
        ) => Promise<{ success: boolean; sessionId?: string }>
        getSession: (sessionId: string) => Promise<QuizSession | null>
        getQuestionChunks: (
          quizId: string,
          questionId: string
        ) => Promise<Array<{ id: string; content: string; documentTitle: string }>>
        update: (quizId: string, updates: { title?: string }) => Promise<{ success: boolean }>
        delete: (quizId: string) => Promise<{ success: boolean }>
        openWindow: (notebookId: string, quizId?: string) => Promise<{ success: boolean }>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
        onGenerated: (
          callback: (data: { notebookId: string; quizId?: string }) => void
        ) => () => void
      }

      // Chat sessions
      createChatSession: (notebookId: string, title: string) => Promise<ChatSession>
      getChatSessions: (notebookId: string) => Promise<ChatSession[]>
      getActiveSession: (notebookId: string) => Promise<ChatSession | null>
      updateSessionTitle: (sessionId: string, title: string) => Promise<void>
      deleteSession: (sessionId: string) => Promise<void>

      // Chat messages
      getMessages: (sessionId: string) => Promise<ChatMessage[]>
      sendMessage: (
        sessionId: string,
        content: string,
        scope?: ChatScope
      ) => Promise<SendMessageResult>
      onMessageCreated: (callback: (data: ChatMessageCreatedEvent) => void) => () => void
      abortMessage: (messageId: string) => Promise<{ success: boolean; reason?: string }>

      // Streaming message listeners (AI SDK streaming protocol format)
      onMessageChunk: (
        callback: (data: {
          messageId: string
          type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'text-delta' | 'finish'
          content?: string
          reasoningId?: string
          metadata?: StreamChunk['metadata']
        }) => void
      ) => () => void
      onMessageError: (
        callback: (data: { messageId: string; notebookId: string; error: string }) => void
      ) => () => void

      // Session auto-switch listener
      onSessionAutoSwitched: (
        callback: (data: { oldSessionId: string; newSessionId: string }) => void
      ) => () => void

      // External local API configuration
      api: {
        getConfig: () => Promise<PublicApiConfig>
        saveConfig: (config: SaveApiConfigInput) => Promise<PublicApiConfig>
        testConnection: (config?: SaveApiConfigInput) => Promise<ApiTestResult>
        checkEncryption: () => Promise<{ encrypted: boolean }>
        onConfigChanged: (callback: () => void) => () => void
      }

      // Knowledge base
      knowledge: {
        // Add a document
        addDocument: (
          notebookId: string,
          options: AddDocumentOptions
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addDocumentFromFile: (
          notebookId: string,
          filePath: string
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addDocumentFromUrl: (
          notebookId: string,
          url: string
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addDocumentsFromFolder: (
          notebookId: string,
          folderPath: string
        ) => Promise<{
          success: boolean
          result?: {
            totalFiles: number
            indexedFiles: number
            failedFiles: Array<{ filePath: string; error: string }>
          }
          error?: string
        }>
        addNote: (
          notebookId: string,
          noteId: string
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        // Search
        search: (
          notebookId: string,
          query: string,
          options?: SearchOptions
        ) => Promise<{ success: boolean; results: KnowledgeSearchResult[]; error?: string }>

        // Document management
        getDocuments: (notebookId: string) => Promise<KnowledgeDocument[]>
        getDocument: (documentId: string) => Promise<KnowledgeDocument | null>
        updateDocumentMetadata: (
          documentId: string,
          metadata: DocumentMetadata
        ) => Promise<{ success: boolean; document?: KnowledgeDocument; error?: string }>
        getDocumentChunks: (documentId: string) => Promise<KnowledgeChunk[]>
        getDocumentPage: (
          documentId: string,
          pageNumber: number,
          highlightText?: string
        ) => Promise<{
          documentId: string
          documentTitle: string
          pageNumber: number
          content: string
          sourceUri?: string
          highlightText?: string
        } | null>
        deleteDocument: (documentId: string) => Promise<{ success: boolean; error?: string }>
        reindexDocument: (documentId: string) => Promise<{ success: boolean; error?: string }>
        enrichDocument: (documentId: string) => Promise<{
          success: boolean
          enrichment?: DocumentEnrichment
          error?: string
        }>
        getNotebookSummary: (notebookId: string) => Promise<{
          success: boolean
          summary?: {
            summary: string
            generatedAt: string
            model?: string
          } | null
          pending?: boolean
          error?: string
        }>
        regenerateNotebookSummary: (notebookId: string) => Promise<{
          success: boolean
          summary?: { summary: string | null; generatedAt: string }
          error?: string
        }>
        refreshDocumentMetadata: (
          documentId: string
        ) => Promise<{ success: boolean; error?: string }>

        // Feedback loop + lifecycle + knowledge links
        recordFeedback: (
          notebookId: string,
          chunkId: string,
          kind: 'citation_good' | 'citation_bad' | 'user_correction',
          note?: string
        ) => Promise<{ success: boolean; error?: string }>
        setDocumentLifecycle: (
          documentId: string,
          state: 'draft' | 'verified' | 'outdated'
        ) => Promise<{
          success: boolean
          document?: KnowledgeDocument
          error?: string
        }>
        getLinks: (
          notebookId: string,
          documentId: string
        ) => Promise<{
          success: boolean
          links: Array<{
            id: string
            sourceDocumentId: string
            targetDocumentId: string
            targetTitle: string
            relationType: 'related' | 'extends' | 'contradicts'
            confidence: number
            evidence?: string | null
          }>
          error?: string
        }>
        generateLinks: (
          documentId: string
        ) => Promise<{ success: boolean; linkCount?: number; error?: string }>

        // Statistics
        getStats: (notebookId: string) => Promise<KnowledgeStats>
        probeEmbeddingDimensions: () => Promise<{
          success: boolean
          dimensions?: number
          error?: string
        }>

        // File selection dialogs
        selectFiles: () => Promise<string[]>
        selectFolder: () => Promise<string | null>

        // Open the source file
        openSource: (documentId: string) => Promise<{ success: boolean; error?: string }>

        // Index progress listener
        onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void
        // Auto-sync listener (incremental reindex triggered by the watcher)
        onAutoSynced: (
          callback: (data: {
            documentId: string
            documentTitle: string
            reason: 'file-changed' | 'note-updated'
            result?: { created: number; reused: number; removed: number }
            error?: string
          }) => void
        ) => () => void
        // Listen for documents newly reloaded into the KB
        onDocumentsChanged: (callback: (data: { notebookId: string }) => void) => () => void
      }

      // Keyboard shortcuts
      shortcuts: {
        getAll: () => Promise<ShortcutConfig[]>
        update: (action: ShortcutAction, accelerator: string) => Promise<void>
        toggle: (action: ShortcutAction, enabled: boolean) => Promise<void>
        resetSingle: (action: ShortcutAction) => Promise<void>
        reset: () => Promise<void>
        onTriggered: (callback: (action: ShortcutAction) => void) => () => void
      }

      // App updates
      update: {
        // Check for updates
        check: () => Promise<UpdateCheckResult>
        // Download an update
        download: () => Promise<UpdateOperationResult>
        // Install the update (quit and install)
        install: () => Promise<UpdateOperationResult>
        // Get the current update state
        getState: () => Promise<UpdateCheckResult>
        // Listen for update state changes
        onStateChanged: (callback: (state: UpdateState) => void) => () => void
      }
    }
  }
}
