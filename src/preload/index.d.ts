import { ElectronAPI } from '@electron-toolkit/preload'
import type { ChatSession, ChatMessage } from '../shared/types/chat'
import type { Notebook, Note, ProviderConfig, AppSettings } from '../shared/types'
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
import type { LicenseStatus } from '../shared/types/license'
import type { MindMap, Quiz, QuizSession } from '../main/db/schema'

export type {
  ChatSession,
  ChatMessage,
  Notebook,
  Note,
  ProviderConfig,
  AppSettings,
  MindMap,
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
export type { LicenseStatus }

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getPlatform: () => Promise<string>

      getAppVersion: () => Promise<string>

      license: {
        getStatus: () => Promise<LicenseStatus>
      }

      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

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

      createNotebook: (title: string, description?: string) => Promise<Notebook>
      getAllNotebooks: () => Promise<Notebook[]>
      getNotebook: (id: string) => Promise<Notebook | null>
      updateNotebook: (
        id: string,
        updates: Partial<Pick<Notebook, 'title' | 'description'>>
      ) => Promise<void>
      deleteNotebook: (id: string) => Promise<void>

      createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
      getNotes: (notebookId: string) => Promise<Note[]>
      getNote: (id: string) => Promise<Note | null>
      updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
      deleteNote: (id: string) => Promise<void>

      items: {
        getAll: (notebookId: string) => Promise<any[]>
        updateOrder: (itemId: string, order: number) => Promise<{ success: boolean }>
        batchUpdateOrder: (updates: Record<string, number>) => Promise<{ success: boolean }>
        delete: (itemId: string, deleteResource?: boolean) => Promise<{ success: boolean }>
      }

      mindmap: {
        getLatest: (notebookId: string) => Promise<MindMap | null>
        get: (mindMapId: string) => Promise<MindMap | null>
        generate: (
          notebookId: string
        ) => Promise<{ success: boolean; mindMapId?: string; error?: string }>
        getNodeChunks: (mindMapId: string, nodeId: string) => Promise<any[]>
        update: (
          mindMapId: string,
          updates: Partial<Pick<MindMap, 'title'>>
        ) => Promise<{ success: boolean }>
        delete: (mindMapId: string) => Promise<{ success: boolean }>
        openWindow: (notebookId: string, mindMapId?: string) => Promise<void>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
      }

      quiz: {
        getLatest: (notebookId: string) => Promise<Quiz | null>
        get: (quizId: string) => Promise<Quiz | null>
        generate: (
          notebookId: string,
          options?: {
            questionCount?: number
            difficulty?: 'easy' | 'medium' | 'hard'
            customPrompt?: string
          }
        ) => Promise<{ success: boolean; quizId?: string; error?: string }>
        submitSession: (
          quizId: string,
          answers: Record<string, number>
        ) => Promise<{ success: boolean; sessionId?: string }>
        getSession: (sessionId: string) => Promise<QuizSession | null>
        update: (quizId: string, updates: { title?: string }) => Promise<{ success: boolean }>
        delete: (quizId: string) => Promise<{ success: boolean }>
        openWindow: (notebookId: string, quizId?: string) => Promise<{ success: boolean }>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
      }

      createChatSession: (notebookId: string, title: string) => Promise<ChatSession>
      getChatSessions: (notebookId: string) => Promise<ChatSession[]>
      getActiveSession: (notebookId: string) => Promise<ChatSession | null>
      updateSessionTitle: (sessionId: string, title: string) => Promise<void>
      deleteSession: (sessionId: string) => Promise<void>

      getMessages: (sessionId: string) => Promise<ChatMessage[]>
      sendMessage: (sessionId: string, content: string, mode?: 'chat' | 'ask') => Promise<string>
      abortMessage: (messageId: string) => Promise<{ success: boolean; reason?: string }>
      podcast: {
        generateScript: (notebookId: string) => Promise<{
          success: boolean
          id?: string
          title?: string
          script?: string
          error?: string
          cancelled?: boolean
        }>
        update: (id: string, updates: { title?: string }) => Promise<{ success: boolean; error?: string }>
        cancel: (notebookId: string) => Promise<{ success: boolean; error?: string }>
        onProgress: (
          callback: (data: { notebookId: string; stage: string; progress: number }) => void
        ) => () => void
        synthesizeAudio: () => Promise<{ success: boolean; error?: string }>
      }

      onMessageChunk: (
        callback: (data: {
          messageId: string
          type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'text-delta' | 'finish'
          content?: string
          reasoningId?: string
          metadata?: any
        }) => void
      ) => () => void
      onMessageError: (callback: (data: { messageId: string; error: string }) => void) => () => void

      onSessionAutoSwitched: (
        callback: (data: { oldSessionId: string; newSessionId: string }) => void
      ) => () => void

      saveProviderConfig: (config: ProviderConfig) => Promise<{ encrypted: boolean }>
      getProviderConfig: (providerName: string) => Promise<ProviderConfig | null>
      getAllProviderConfigs: () => Promise<ProviderConfig[]>
      deleteProviderConfig: (providerName: string) => Promise<void>
      validateProviderConfig: (providerName: string, config: any) => Promise<boolean>
      fetchModels: (
        providerName: string,
        apiKey: string
      ) => Promise<
        | {
            models: {
              id: string
              object: string
              owned_by?: string
              created?: number
              type?: string
            }[]
            source: 'merged' | 'builtin'
            builtinCount?: number
            remoteCount?: number
            error?: string
          }
        | { id: string; object: string; owned_by?: string; created?: number }[]
      >
      getProviderModels: (
        providerName: string
      ) => Promise<{ id: string; object: string; owned_by?: string; created?: number }[]>
      onProviderConfigChanged: (callback: () => void) => () => void

      // Check if secure encryption is available for API keys
      checkEncryption: () => Promise<{ encrypted: boolean }>

      knowledge: {
        addDocument: (
          notebookId: string,
          options: AddDocumentOptions
        ) => Promise<{ success: boolean; documentId?: string; error?: string }>
        addDocumentFromFile: (
          notebookId: string,
          filePath: string
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
        search: (
          notebookId: string,
          query: string,
          options?: SearchOptions
        ) => Promise<{ success: boolean; results: KnowledgeSearchResult[]; error?: string }>

        getDocuments: (notebookId: string) => Promise<KnowledgeDocument[]>
        getDocument: (documentId: string) => Promise<KnowledgeDocument | null>
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

        getStats: (notebookId: string) => Promise<KnowledgeStats>

        selectFiles: () => Promise<string[]>
        selectFolder: () => Promise<string | null>

        openSource: (documentId: string) => Promise<{ success: boolean; error?: string }>

        onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void
      }

      templates: {
        selectTemplate: (kind: 'word' | 'excel') => Promise<string | null>
        selectOutput: (kind: 'word' | 'excel') => Promise<string | null>
        generateWord: (
          templatePath: string,
          outputPath: string,
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; outputPath?: string; error?: string }>
        generateExcel: (
          templatePath: string,
          outputPath: string,
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; outputPath?: string; error?: string }>
      }

      // Llama model management
      llama: {
        listModels: () => Promise<
          Array<{
            filename: string
            type: 'chat' | 'embedding' | 'reranker' | 'unknown'
            sizeMB: number
            addedAt: string | null
          }>
        >
        importModel: (type: 'chat' | 'embedding' | 'reranker') => Promise<{
          success: boolean
          filename?: string
          sizeMB?: number
          type?: string
          reason?: string
        }>
        removeModel: (filename: string) => Promise<{ success: boolean; reason?: string }>
        getServerInfo: () => Promise<{
          binary: string | null
          chatPort: number
          embedPort: number
          backend: 'llama-bin'
          chatCtxSize: number
          embeddingCtxSize: number
          threads: number
        }>
      }

      update: {
        check: () => Promise<UpdateCheckResult>
        download: () => Promise<UpdateOperationResult>
        install: () => Promise<UpdateOperationResult>
        getState: () => Promise<UpdateCheckResult>
        onStateChanged: (callback: (state: UpdateState) => void) => () => void
      }
    }
  }
}
