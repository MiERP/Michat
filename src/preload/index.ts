import { contextBridge, ipcRenderer } from 'electron'
import type { DocumentMetadata } from '../shared/legalMetadata'
import type {
  AppSettings,
  ChatMessageErrorEvent,
  ChatMessageCreatedEvent,
  Note,
  Notebook,
  SendMessageResult,
  ShortcutAction,
  ShortcutConfig
} from '../shared/types'
import type { PublicApiConfig, SaveApiConfigInput, ApiTestResult } from '../shared/types/api'
import type { UpdateState } from '../shared/types/update'
import type { StreamChunk } from '../shared/types/chat'
import type { AddDocumentOptions, IndexProgress, SearchOptions } from '../shared/types/knowledge'

/** Payload emitted by the main process after an incremental auto-sync run. */
interface AutoSyncEvent {
  documentId: string
  documentTitle: string
  reason: 'file-changed' | 'note-updated'
  result?: { created: number; reused: number; removed: number }
  error?: string
}

/** Streaming chunk payload emitted over the `message-chunk` channel. */
interface MessageChunkEvent {
  messageId: string
  type: 'reasoning-start' | 'reasoning-delta' | 'reasoning-end' | 'text-delta' | 'finish'
  content?: string
  reasoningId?: string
  metadata?: StreamChunk['metadata']
}

interface QuizGenerateOptions {
  questionCount?: number
  difficulty?: 'easy' | 'medium' | 'hard'
  customPrompt?: string
  documentIds?: string[]
}

async function invokeWithTimeout<T>(
  channel: string,
  timeout: number,
  ...args: unknown[]
): Promise<T> {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC call timed out: ${channel} (${timeout}ms)`)), timeout)
    )
  ])
}

// Custom APIs for renderer
const api = {
  // Get platform information
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),

  // Get the app version
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // Open an external link in the default browser
  openExternalUrl: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-external-url', url),

  // App settings
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    update: (updates: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', { updates }),
    set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
      ipcRenderer.invoke('settings:set', { key, value }),
    reset: () => ipcRenderer.invoke('settings:reset'),
    getDefaultPrompts: () => ipcRenderer.invoke('settings:getDefaultPrompts'),
    // Listen for settings changes
    onSettingsChange: (callback: (newSettings: AppSettings, oldSettings: AppSettings) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        newSettings: AppSettings,
        oldSettings: AppSettings
      ) => callback(newSettings, oldSettings)
      ipcRenderer.on('settings:changed', listener)
      // Return a cleanup function
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },

  // Notebooks
  createNotebook: (title: string, description?: string) =>
    ipcRenderer.invoke('create-notebook', { title, description }),
  getAllNotebooks: () => ipcRenderer.invoke('get-all-notebooks'),
  getNotebook: (id: string) => ipcRenderer.invoke('get-notebook', { id }),
  updateNotebook: (id: string, updates: Partial<Pick<Notebook, 'title' | 'description'>>) =>
    ipcRenderer.invoke('update-notebook', { id, updates }),
  deleteNotebook: (id: string) => ipcRenderer.invoke('delete-notebook', { id }),

  // Notes
  createNote: (notebookId: string, content: string, customTitle?: string) =>
    ipcRenderer.invoke('create-note', { notebookId, title: customTitle || '', content }),
  getNotes: (notebookId: string) => ipcRenderer.invoke('get-notes', { notebookId }),
  getNote: (id: string) => ipcRenderer.invoke('get-note', { id }),
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) =>
    ipcRenderer.invoke('update-note', { id, updates }),
  deleteNote: (id: string) => ipcRenderer.invoke('delete-note', { id }),

  // Items (unified management of notes, quizzes, etc.)
  items: {
    getAll: (notebookId: string) => ipcRenderer.invoke('items:get', { notebookId }),
    updateOrder: (itemId: string, order: number) =>
      ipcRenderer.invoke('items:update-order', { itemId, order }),
    batchUpdateOrder: (updates: Record<string, number>) =>
      ipcRenderer.invoke('items:batch-update-order', { updates }),
    delete: (itemId: string, deleteResource = false) =>
      ipcRenderer.invoke('items:delete', { itemId, deleteResource })
  },

  // Chat sessions
  createChatSession: (notebookId: string, title: string) =>
    ipcRenderer.invoke('create-chat-session', { notebookId, title }),
  getChatSessions: (notebookId: string) => ipcRenderer.invoke('get-chat-sessions', { notebookId }),
  getActiveSession: (notebookId: string) =>
    ipcRenderer.invoke('get-active-session', { notebookId }),
  updateSessionTitle: (sessionId: string, title: string) =>
    ipcRenderer.invoke('update-session-title', { sessionId, title }),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', { sessionId }),

  // Chat messages
  getMessages: (sessionId: string) => invokeWithTimeout('get-messages', 10000, { sessionId }),
  sendMessage: (sessionId: string, content: string, scope?: unknown): Promise<SendMessageResult> =>
    invokeWithTimeout('send-message', 60000, { sessionId, content, scope }), // 60s timeout (streamed messages can be long)
  abortMessage: (messageId: string) => invokeWithTimeout('abort-message', 5000, { messageId }),

  // Emitted as soon as the assistant placeholder row exists.
  onMessageCreated: (callback: (data: ChatMessageCreatedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ChatMessageCreatedEvent) =>
      callback(data)
    ipcRenderer.on('message-created', listener)
    return () => ipcRenderer.removeListener('message-created', listener)
  },

  // Streaming message listeners
  onMessageChunk: (callback: (data: MessageChunkEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: MessageChunkEvent) => callback(data)
    ipcRenderer.on('message-chunk', listener)
    // Return a cleanup function
    return () => ipcRenderer.removeListener('message-chunk', listener)
  },

  onMessageError: (callback: (data: ChatMessageErrorEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ChatMessageErrorEvent) =>
      callback(data)
    ipcRenderer.on('message-error', listener)
    return () => ipcRenderer.removeListener('message-error', listener)
  },

  // Session listeners
  onSessionAutoSwitched: (
    callback: (data: { oldSessionId: string; newSessionId: string }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { oldSessionId: string; newSessionId: string }
    ) => callback(data)
    ipcRenderer.on('session-auto-switched', listener)
    return () => ipcRenderer.removeListener('session-auto-switched', listener)
  },

  // External local API configuration
  api: {
    getConfig: (): Promise<PublicApiConfig> => ipcRenderer.invoke('api:get-config'),
    saveConfig: (config: SaveApiConfigInput): Promise<PublicApiConfig> =>
      invokeWithTimeout('api:save-config', 5000, config),
    testConnection: (config?: SaveApiConfigInput): Promise<ApiTestResult> =>
      invokeWithTimeout('api:test-connection', 15000, config ?? {}),
    checkEncryption: (): Promise<{ encrypted: boolean }> =>
      ipcRenderer.invoke('api:check-encryption'),
    onConfigChanged: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('api:config-changed', listener)
      return () => ipcRenderer.removeListener('api:config-changed', listener)
    }
  },

  // Knowledge base
  knowledge: {
    // Add a document
    addDocument: (notebookId: string, options: AddDocumentOptions) =>
      ipcRenderer.invoke('knowledge:add-document', { notebookId, options }),
    addDocumentFromFile: (notebookId: string, filePath: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-file', { notebookId, filePath }),
    addDocumentFromUrl: (notebookId: string, url: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-url', { notebookId, url }),
    addDocumentsFromFolder: (notebookId: string, folderPath: string) =>
      ipcRenderer.invoke('knowledge:add-documents-from-folder', { notebookId, folderPath }),
    addNote: (notebookId: string, noteId: string) =>
      ipcRenderer.invoke('knowledge:add-note', { notebookId, noteId }),

    // Search
    search: (notebookId: string, query: string, options?: SearchOptions) =>
      ipcRenderer.invoke('knowledge:search', { notebookId, query, options }),

    // Document management
    getDocuments: (notebookId: string) =>
      ipcRenderer.invoke('knowledge:get-documents', { notebookId }),
    getDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document', { documentId }),
    updateDocumentMetadata: (documentId: string, metadata: DocumentMetadata) =>
      ipcRenderer.invoke('knowledge:update-document-metadata', { documentId, metadata }),
    getDocumentChunks: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document-chunks', { documentId }),
    getDocumentPage: (documentId: string, pageNumber: number, highlightText?: string) =>
      ipcRenderer.invoke('knowledge:get-document-page', { documentId, pageNumber, highlightText }),
    deleteDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:delete-document', { documentId }),
    reindexDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:reindex-document', { documentId }),

    enrichDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:enrich-document', { documentId }),

    // Tóm tắt thống nhất cấp notebook (hiển thị trong khung chat)
    getNotebookSummary: (notebookId: string) =>
      ipcRenderer.invoke('knowledge:get-notebook-summary', { notebookId }),
    regenerateNotebookSummary: (notebookId: string) =>
      invokeWithTimeout('knowledge:regenerate-notebook-summary', 300000, { notebookId }),

    refreshDocumentMetadata: (documentId: string) =>
      ipcRenderer.invoke('knowledge:refresh-document-metadata', { documentId }),

    // Statistics
    getStats: (notebookId: string) => ipcRenderer.invoke('knowledge:get-stats', { notebookId }),

    // Kiểm tra số chiều embedding trước khi giữ lựa chọn model mới
    probeEmbeddingDimensions: () => ipcRenderer.invoke('knowledge:probe-embedding-dimensions'),

    // File selection
    selectFiles: () => ipcRenderer.invoke('knowledge:select-files'),
    selectFolder: () => ipcRenderer.invoke('knowledge:select-folder'),

    // Open the source file
    openSource: (documentId: string) => ipcRenderer.invoke('knowledge:open-source', { documentId }),

    // Progress listener
    onIndexProgress: (callback: (data: IndexProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: IndexProgress) => callback(data)
      ipcRenderer.on('knowledge:index-progress', listener)
      return () => ipcRenderer.removeListener('knowledge:index-progress', listener)
    },

    // Auto-sync listener (incremental reindex triggered by the watcher)
    onAutoSynced: (callback: (data: AutoSyncEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: AutoSyncEvent) => callback(data)
      ipcRenderer.on('knowledge:auto-synced', listener)
      return () => ipcRenderer.removeListener('knowledge:auto-synced', listener)
    },

    // Listen for newly loaded documents in the KB
    onDocumentsChanged: (callback: (data: { notebookId: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { notebookId: string }) =>
        callback(data)
      ipcRenderer.on('knowledge:documents-changed', listener)
      return () => ipcRenderer.removeListener('knowledge:documents-changed', listener)
    },

    // Feedback loop + lifecycle + knowledge links
    recordFeedback: (notebookId: string, chunkId: string, kind: string, note?: string) =>
      ipcRenderer.invoke('knowledge:record-feedback', { notebookId, chunkId, kind, note }),
    setDocumentLifecycle: (documentId: string, state: string) =>
      ipcRenderer.invoke('knowledge:set-document-lifecycle', { documentId, state }),
    getLinks: (notebookId: string, documentId: string) =>
      ipcRenderer.invoke('knowledge:get-links', { notebookId, documentId }),
    generateLinks: (documentId: string) =>
      ipcRenderer.invoke('knowledge:generate-links', { documentId })
  },

  // Quiz
  quiz: {
    // Generate questions
    generate: (notebookId: string, options?: QuizGenerateOptions) =>
      ipcRenderer.invoke('quiz:generate', { notebookId, options }),
    // Get the latest quiz
    getLatest: (notebookId: string) => ipcRenderer.invoke('quiz:get-latest', { notebookId }),
    // Get quiz details
    get: (quizId: string) => ipcRenderer.invoke('quiz:get', { quizId }),
    // Submit an answer session
    submitSession: (quizId: string, answers: Record<string, number>) =>
      ipcRenderer.invoke('quiz:submit-session', { quizId, answers }),
    // Get an answer session
    getSession: (sessionId: string) => ipcRenderer.invoke('quiz:get-session', { sessionId }),
    // Get the source chunks for a question
    getQuestionChunks: (quizId: string, questionId: string) =>
      ipcRenderer.invoke('quiz:get-question-chunks', { quizId, questionId }),
    // Update the quiz
    update: (quizId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('quiz:update', { quizId, updates }),
    // Delete the quiz
    delete: (quizId: string) => ipcRenderer.invoke('quiz:delete', { quizId }),
    // Open the quiz window
    openWindow: (notebookId: string, quizId?: string) =>
      ipcRenderer.invoke('quiz:open-window', { notebookId, quizId }),
    // Listen for generation progress
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { notebookId: string; stage: string; progress: number }
      ) => callback(data)
      ipcRenderer.on('quiz:progress', listener)
      return () => ipcRenderer.removeListener('quiz:progress', listener)
    },
    // Listen for generation completion (success or failure) to refresh the list
    onGenerated: (callback: (data: { notebookId: string; quizId?: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { notebookId: string; quizId?: string }
      ) => callback(data)
      ipcRenderer.on('quiz:generated', listener)
      return () => ipcRenderer.removeListener('quiz:generated', listener)
    }
  },

  // Keyboard shortcuts
  shortcuts: {
    getAll: (): Promise<ShortcutConfig[]> => ipcRenderer.invoke('shortcuts:getAll'),
    update: (action: ShortcutAction, accelerator: string): Promise<void> =>
      ipcRenderer.invoke('shortcuts:update', { action, accelerator }),
    toggle: (action: ShortcutAction, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('shortcuts:toggle', { action, enabled }),
    resetSingle: (action: ShortcutAction): Promise<void> =>
      ipcRenderer.invoke('shortcuts:resetSingle', { action }),
    reset: (): Promise<void> => ipcRenderer.invoke('shortcuts:reset'),
    onTriggered: (callback: (action: ShortcutAction) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: ShortcutAction): void =>
        callback(action)
      ipcRenderer.on('shortcut:triggered', listener)
      return () => ipcRenderer.removeListener('shortcut:triggered', listener)
    }
  },

  // App updates
  update: {
    // Check for updates
    check: () => ipcRenderer.invoke('update:check'),
    // Download an update
    download: () => ipcRenderer.invoke('update:download'),
    // Install the update (quit and install)
    install: () => ipcRenderer.invoke('update:install'),
    // Get the current update state
    getState: () => ipcRenderer.invoke('update:get-state'),
    // Listen for update state changes
    onStateChanged: (callback: (state: UpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
      ipcRenderer.on('update:state-changed', listener)
      return () => ipcRenderer.removeListener('update:state-changed', listener)
    }
  }
}

// Fail closed: the renderer must run with context isolation. Never fall back
// to assigning Node-backed objects directly on `window`.
if (!process.contextIsolated) {
  throw new Error('MiChat requires context isolation; refusing to expose the preload API')
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
