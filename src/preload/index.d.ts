import type {
  ChatSession,
  ChatMessage,
  ChatScope,
  ChatMessageCreatedEvent,
  SendMessageResult
} from '../shared/types/chat'
import type {
  Notebook,
  Note,
  ProviderConfig,
  PublicProviderConfig,
  AppSettings,
  ShortcutAction,
  ShortcutConfig
} from '../shared/types'
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
import type { Quiz, QuizSession } from '../main/db/schema'
import type { DocumentMetadata } from '../main/services/DocumentMetadataExtractionService'
import type { DocumentEnrichment } from '../main/services/DocumentEnrichmentService'

// 重新导出共享类型
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
export type { LicenseStatus }

declare global {
  interface Window {
    api: {
      // 获取平台信息
      getPlatform: () => Promise<string>

      // 获取应用版本号
      getAppVersion: () => Promise<string>

      // 许可证
      license: {
        getStatus: () => Promise<LicenseStatus>
      }

      // 在默认浏览器中打开外部链接
      openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

      // 应用设置相关
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

      // Notebook 相关
      createNotebook: (title: string, description?: string) => Promise<Notebook>
      getAllNotebooks: () => Promise<Notebook[]>
      getNotebook: (id: string) => Promise<Notebook | null>
      updateNotebook: (
        id: string,
        updates: Partial<Pick<Notebook, 'title' | 'description'>>
      ) => Promise<void>
      deleteNotebook: (id: string) => Promise<void>

      // Note 相关
      createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
      getNotes: (notebookId: string) => Promise<Note[]>
      getNote: (id: string) => Promise<Note | null>
      updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
      deleteNote: (id: string) => Promise<void>

      // Items 相关（统一管理笔记、题库等）
      items: {
        getAll: (notebookId: string) => Promise<any[]>
        updateOrder: (itemId: string, order: number) => Promise<{ success: boolean }>
        batchUpdateOrder: (updates: Record<string, number>) => Promise<{ success: boolean }>
        delete: (itemId: string, deleteResource?: boolean) => Promise<{ success: boolean }>
      }

      // Quiz 相关
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

      // Chat Session 相关
      createChatSession: (notebookId: string, title: string) => Promise<ChatSession>
      getChatSessions: (notebookId: string) => Promise<ChatSession[]>
      getActiveSession: (notebookId: string) => Promise<ChatSession | null>
      updateSessionTitle: (sessionId: string, title: string) => Promise<void>
      deleteSession: (sessionId: string) => Promise<void>

      // Chat Message 相关
      getMessages: (sessionId: string) => Promise<ChatMessage[]>
      sendMessage: (
        sessionId: string,
        content: string,
        scope?: ChatScope
      ) => Promise<SendMessageResult>
      onMessageCreated: (callback: (data: ChatMessageCreatedEvent) => void) => () => void
      abortMessage: (messageId: string) => Promise<{ success: boolean; reason?: string }>

      // 流式消息监听（AI SDK 流式协议格式）
      onMessageChunk: (
        callback: (data: {
          messageId: string
          type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'text-delta' | 'finish'
          content?: string
          reasoningId?: string
          metadata?: any
        }) => void
      ) => () => void
      onMessageError: (
        callback: (data: { messageId: string; notebookId: string; error: string }) => void
      ) => () => void

      // Session 自动切换监听
      onSessionAutoSwitched: (
        callback: (data: { oldSessionId: string; newSessionId: string }) => void
      ) => () => void

      // Provider 配置相关
      saveProviderConfig: (
        config: ProviderConfig & { clearApiKey?: boolean }
      ) => Promise<{ encrypted: boolean }>
      getProviderConfig: (providerName: string) => Promise<PublicProviderConfig | null>
      getAllProviderConfigs: () => Promise<PublicProviderConfig[]>
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

      // 知识库相关
      knowledge: {
        // 添加文档
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
        // 搜索
        search: (
          notebookId: string,
          query: string,
          options?: SearchOptions
        ) => Promise<{ success: boolean; results: KnowledgeSearchResult[]; error?: string }>

        // 文档管理
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

        // 统计
        getStats: (notebookId: string) => Promise<KnowledgeStats>
        probeEmbeddingDimensions: () => Promise<{
          success: boolean
          dimensions?: number
          error?: string
        }>

        // 文件选择对话框
        selectFiles: () => Promise<string[]>
        selectFolder: () => Promise<string | null>

        // 打开源文件
        openSource: (documentId: string) => Promise<{ success: boolean; error?: string }>

        // 索引进度监听
        onIndexProgress: (callback: (progress: IndexProgress) => void) => () => void
        // 自动同步监听（watcher 触发的增量 reindex）
        onAutoSynced: (callback: (data: any) => void) => () => void
        // 监听 tài liệu mới được nạp lại vào KB
        onDocumentsChanged: (callback: (data: { notebookId: string }) => void) => () => void
      }

      // Llama model management
      llama: {
        listModels: () => Promise<
          Array<{
            filename: string
            type: 'chat' | 'embedding' | 'unknown'
            sizeMB: number
            addedAt: string | null
          }>
        >
        importModel: (type: 'chat' | 'embedding') => Promise<{
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
          backend: 'cuda-12.4-x64' | 'cuda-13.1-x64' | 'vulkan-x64' | 'cpu-x64'
          chatCtxSize: number
          embeddingCtxSize: number
          threads: number
        }>
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

      // 应用更新相关
      update: {
        // 检查更新
        check: () => Promise<UpdateCheckResult>
        // 下载更新
        download: () => Promise<UpdateOperationResult>
        // 安装更新（退出并安装）
        install: () => Promise<UpdateOperationResult>
        // 获取当前更新状态
        getState: () => Promise<UpdateCheckResult>
        // 监听更新状态变化
        onStateChanged: (callback: (state: UpdateState) => void) => () => void
      }
    }
  }
}
