import { contextBridge, ipcRenderer } from 'electron'
import type { DocumentMetadata } from '../main/services/DocumentMetadataExtractionService'
import type { ShortcutAction, ShortcutConfig } from '../shared/types'

async function invokeWithTimeout<T>(channel: string, timeout: number, ...args: any[]): Promise<T> {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC调用超时: ${channel} (${timeout}ms)`)), timeout)
    )
  ])
}

// Custom APIs for renderer
const api = {
  // 获取平台信息
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),

  // 获取应用版本号
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // 许可证
  license: {
    getStatus: () => ipcRenderer.invoke('license:get-status')
  },

  // 在默认浏览器中打开外部链接
  openExternalUrl: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-external-url', url),

  // 应用设置相关
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    update: (updates: any) => ipcRenderer.invoke('settings:update', { updates }),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', { key, value }),
    reset: () => ipcRenderer.invoke('settings:reset'),
    getDefaultPrompts: () => ipcRenderer.invoke('settings:getDefaultPrompts'),
    // 监听设置变化
    onSettingsChange: (callback: (newSettings: any, oldSettings: any) => void) => {
      const listener = (_event: any, newSettings: any, oldSettings: any) =>
        callback(newSettings, oldSettings)
      ipcRenderer.on('settings:changed', listener)
      // 返回清理函数
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },

  // Notebook 相关
  createNotebook: (title: string, description?: string) =>
    ipcRenderer.invoke('create-notebook', { title, description }),
  getAllNotebooks: () => ipcRenderer.invoke('get-all-notebooks'),
  getNotebook: (id: string) => ipcRenderer.invoke('get-notebook', { id }),
  updateNotebook: (id: string, updates: any) =>
    ipcRenderer.invoke('update-notebook', { id, updates }),
  deleteNotebook: (id: string) => ipcRenderer.invoke('delete-notebook', { id }),

  // Note 相关
  createNote: (notebookId: string, content: string, customTitle?: string) =>
    ipcRenderer.invoke('create-note', { notebookId, title: customTitle || '', content }),
  getNotes: (notebookId: string) => ipcRenderer.invoke('get-notes', { notebookId }),
  getNote: (id: string) => ipcRenderer.invoke('get-note', { id }),
  updateNote: (id: string, updates: any) => ipcRenderer.invoke('update-note', { id, updates }),
  deleteNote: (id: string) => ipcRenderer.invoke('delete-note', { id }),

  // Items 相关（统一管理笔记、题库等）
  items: {
    getAll: (notebookId: string) => ipcRenderer.invoke('items:get', { notebookId }),
    updateOrder: (itemId: string, order: number) =>
      ipcRenderer.invoke('items:update-order', { itemId, order }),
    batchUpdateOrder: (updates: Record<string, number>) =>
      ipcRenderer.invoke('items:batch-update-order', { updates }),
    delete: (itemId: string, deleteResource = false) =>
      ipcRenderer.invoke('items:delete', { itemId, deleteResource })
  },

  // Chat Session 相关
  createChatSession: (notebookId: string, title: string) =>
    ipcRenderer.invoke('create-chat-session', { notebookId, title }),
  getChatSessions: (notebookId: string) => ipcRenderer.invoke('get-chat-sessions', { notebookId }),
  getActiveSession: (notebookId: string) =>
    ipcRenderer.invoke('get-active-session', { notebookId }),
  updateSessionTitle: (sessionId: string, title: string) =>
    ipcRenderer.invoke('update-session-title', { sessionId, title }),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', { sessionId }),

  // Chat Message 相关
  getMessages: (sessionId: string) => invokeWithTimeout('get-messages', 10000, { sessionId }),
  sendMessage: (sessionId: string, content: string, scope?: unknown) =>
    invokeWithTimeout('send-message', 60000, { sessionId, content, scope }), // 60秒超时（流式消息可能较长）
  abortMessage: (messageId: string) => invokeWithTimeout('abort-message', 5000, { messageId }),

  // 流式消息监听
  onMessageChunk: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-chunk', listener)
    // 返回清理函数
    return () => ipcRenderer.removeListener('message-chunk', listener)
  },

  onMessageError: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-error', listener)
    return () => ipcRenderer.removeListener('message-error', listener)
  },

  // Session 监听
  onSessionAutoSwitched: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session-auto-switched', listener)
    return () => ipcRenderer.removeListener('session-auto-switched', listener)
  },

  // Provider config
  saveProviderConfig: (config: any) => invokeWithTimeout('save-provider-config', 5000, config),
  getProviderConfig: (providerName: string) =>
    ipcRenderer.invoke('get-provider-config', { providerName }),
  getAllProviderConfigs: () => ipcRenderer.invoke('get-all-provider-configs'),
  deleteProviderConfig: (providerName: string) =>
    ipcRenderer.invoke('delete-provider-config', { providerName }),
  validateProviderConfig: (providerName: string, config: any) =>
    invokeWithTimeout('validate-provider-config', 15000, { providerName, config }),
  fetchModels: (providerName: string, apiKey: string) =>
    invokeWithTimeout('fetch-models', 15000, { providerName, apiKey }),
  getProviderModels: (providerName: string) =>
    ipcRenderer.invoke('get-provider-models', { providerName }),

  onProviderConfigChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('provider-config-changed', listener)
    return () => ipcRenderer.removeListener('provider-config-changed', listener)
  },

  // Check if API key encryption is available
  checkEncryption: (): Promise<{ encrypted: boolean }> => ipcRenderer.invoke('check-encryption'),

  // Llama model management
  llama: {
    listModels: () => ipcRenderer.invoke('llama:list-models'),
    importModel: (type: 'chat' | 'embedding') => ipcRenderer.invoke('llama:import-model', { type }),
    removeModel: (filename: string) => ipcRenderer.invoke('llama:remove-model', { filename }),
    getServerInfo: () => ipcRenderer.invoke('llama:get-server-info')
  },

  // Knowledge 知识库相关
  knowledge: {
    // 添加文档
    addDocument: (notebookId: string, options: any) =>
      ipcRenderer.invoke('knowledge:add-document', { notebookId, options }),
    addDocumentFromFile: (notebookId: string, filePath: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-file', { notebookId, filePath }),
    addDocumentFromUrl: (notebookId: string, url: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-url', { notebookId, url }),
    addDocumentsFromFolder: (notebookId: string, folderPath: string) =>
      ipcRenderer.invoke('knowledge:add-documents-from-folder', { notebookId, folderPath }),
    addNote: (notebookId: string, noteId: string) =>
      ipcRenderer.invoke('knowledge:add-note', { notebookId, noteId }),

    // 搜索
    search: (notebookId: string, query: string, options?: any) =>
      ipcRenderer.invoke('knowledge:search', { notebookId, query, options }),

    // 文档管理
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

    // 统计
    getStats: (notebookId: string) => ipcRenderer.invoke('knowledge:get-stats', { notebookId }),

    // Kiểm tra số chiều embedding trước khi giữ lựa chọn model mới
    probeEmbeddingDimensions: () => ipcRenderer.invoke('knowledge:probe-embedding-dimensions'),

    // 文件选择
    selectFiles: () => ipcRenderer.invoke('knowledge:select-files'),
    selectFolder: () => ipcRenderer.invoke('knowledge:select-folder'),

    // 打开源文件
    openSource: (documentId: string) => ipcRenderer.invoke('knowledge:open-source', { documentId }),

    // 进度监听
    onIndexProgress: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('knowledge:index-progress', listener)
      return () => ipcRenderer.removeListener('knowledge:index-progress', listener)
    },

    // 自动同步监听（watcher 触发的增量 reindex）
    onAutoSynced: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('knowledge:auto-synced', listener)
      return () => ipcRenderer.removeListener('knowledge:auto-synced', listener)
    },

    // 监听 tài liệu mới được nạp vào KB
    onDocumentsChanged: (callback: (data: { notebookId: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data)
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

  // Quiz 答题相关
  quiz: {
    // 生成题目
    generate: (notebookId: string, options?: any) =>
      ipcRenderer.invoke('quiz:generate', { notebookId, options }),
    // 获取最新题库
    getLatest: (notebookId: string) => ipcRenderer.invoke('quiz:get-latest', { notebookId }),
    // 获取题库详情
    get: (quizId: string) => ipcRenderer.invoke('quiz:get', { quizId }),
    // 提交答题会话
    submitSession: (quizId: string, answers: Record<string, number>) =>
      ipcRenderer.invoke('quiz:submit-session', { quizId, answers }),
    // 获取答题会话
    getSession: (sessionId: string) => ipcRenderer.invoke('quiz:get-session', { sessionId }),
    // 获取 nguồn chunk của một câu hỏi
    getQuestionChunks: (quizId: string, questionId: string) =>
      ipcRenderer.invoke('quiz:get-question-chunks', { quizId, questionId }),
    // 更新题库
    update: (quizId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('quiz:update', { quizId, updates }),
    // 删除题库
    delete: (quizId: string) => ipcRenderer.invoke('quiz:delete', { quizId }),
    // 打开答题窗口
    openWindow: (notebookId: string, quizId?: string) =>
      ipcRenderer.invoke('quiz:open-window', { notebookId, quizId }),
    // 监听生成进度
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('quiz:progress', listener)
      return () => ipcRenderer.removeListener('quiz:progress', listener)
    },
    // 监听生成 kết thúc (thành công hoặc thất bại) để refresh danh sách
    onGenerated: (callback: (data: { notebookId: string; quizId?: string }) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('quiz:generated', listener)
      return () => ipcRenderer.removeListener('quiz:generated', listener)
    }
  },

  // Keyboard shortcuts
  shortcuts: {
    getAll: (): Promise<ShortcutConfig[]> => ipcRenderer.invoke('shortcuts:getAll'),
    update: (action: ShortcutAction, accelerator: string): Promise<void> =>
      ipcRenderer.invoke('shortcuts:update', action, accelerator),
    toggle: (action: ShortcutAction, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('shortcuts:toggle', action, enabled),
    resetSingle: (action: ShortcutAction): Promise<void> =>
      ipcRenderer.invoke('shortcuts:resetSingle', action),
    reset: (): Promise<void> => ipcRenderer.invoke('shortcuts:reset'),
    onTriggered: (callback: (action: ShortcutAction) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: ShortcutAction): void =>
        callback(action)
      ipcRenderer.on('shortcut:triggered', listener)
      return () => ipcRenderer.removeListener('shortcut:triggered', listener)
    }
  },

  // 应用更新相关
  update: {
    // 检查更新
    check: () => ipcRenderer.invoke('update:check'),
    // 下载更新
    download: () => ipcRenderer.invoke('update:download'),
    // 安装更新（退出并安装）
    install: () => ipcRenderer.invoke('update:install'),
    // 获取当前更新状态
    getState: () => ipcRenderer.invoke('update:get-state'),
    // 监听更新状态变化
    onStateChanged: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state)
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
