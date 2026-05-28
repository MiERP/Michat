/**
 * IPC 参数验证
 * 使用 Zod 进行运行时类型验证，防止注入攻击和无效数据
 */

import { z } from 'zod'
import { Result, Err, Ok } from '../../shared/types/result'
import Logger from '../../shared/utils/logger'

/**
 * 设置相关的验证 schemas
 */
export const SettingsSchemas = {
  get: z.object({
    key: z.string().min(1, 'Settings key cannot be empty')
  }),

  set: z.object({
    key: z.string().min(1, 'Settings key cannot be empty'),
    value: z.any()
  }),

  update: z.object({
    updates: z.record(z.string(), z.any())
  })
}

/**
 * 笔记本相关的验证 schemas
 */
export const NotebookSchemas = {
  createNotebook: z.object({
    title: z
      .string()
      .min(1, 'Title cannot be empty')
      .max(200, 'Title cannot exceed 200 characters'),
    description: z.string().max(1000, 'Description cannot exceed 1000 characters').optional()
  }),

  updateNotebook: z.object({
    id: z.string().min(1, 'ID cannot be empty'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional()
    })
  }),

  deleteNotebook: z.object({
    id: z.string().min(1, 'ID cannot be empty')
  }),

  getNotebook: z.object({
    id: z.string().min(1, 'ID cannot be empty')
  })
}

/**
 * 笔记相关的验证 schemas
 */
export const NoteSchemas = {
  createNote: z.object({
    notebookId: z.string().min(1, { message: 'Notebook ID cannot be empty' }),
    title: z.string().max(200, { message: 'Title cannot exceed 200 characters' }),
    content: z.string()
  }),

  getNotes: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),

  getNote: z.object({
    id: z.string().min(1, 'ID cannot be empty')
  }),

  updateNote: z.object({
    id: z.string().min(1, 'ID cannot be empty'),
    updates: z.object({
      title: z.string().min(1).max(200).optional(),
      content: z.string().optional()
    })
  }),

  deleteNote: z.object({
    id: z.string().min(1, 'ID cannot be empty')
  })
}

/**
 * Provider 相关的验证 schemas
 */
export const ProviderSchemas = {
  saveProviderConfig: z.object({
    providerName: z.string().min(1, { message: 'Provider name cannot be empty' }),
    config: z.record(z.string(), z.any()),
    enabled: z.boolean()
  }),

  getProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty')
  }),

  deleteProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty')
  }),

  validateProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty'),
    config: z.record(z.string(), z.any())
  }),

  fetchModels: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty'),
    apiKey: z.string().min(1, 'API Key cannot be empty')
  }),

  getProviderModels: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty')
  })
}

/**
 * 知识库相关的验证 schemas
 */
export const KnowledgeSchemas = {
  addDocument: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    options: z.object({
      title: z.string().min(1, 'Title cannot be empty'),
      type: z.enum(['file', 'note', 'text']),
      content: z.string(),
      sourceUri: z.string().optional(),
      sourceNoteId: z.string().optional(),
      mimeType: z.string().optional(),
      fileSize: z.number().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      chunkOptions: z.any().optional()
    })
  }),

  // S-02: Validate file path to prevent path traversal attacks
  addDocumentFromFile: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    filePath: z
      .string()
      .min(1, 'File path cannot be empty')
      .refine((p) => !p.includes('..') && !p.includes('%2e%2e') && !p.includes('%2E%2E'), {
        message: 'Invalid file path: path traversal not allowed'
      })
  }),

  addDocumentsFromFolder: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    folderPath: z
      .string()
      .min(1, 'Folder path cannot be empty')
      .refine((p) => !p.includes('..') && !p.includes('%2e%2e') && !p.includes('%2E%2E'), {
        message: 'Invalid folder path: path traversal not allowed'
      })
  }),


  addNote: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    noteId: z.string().min(1, 'Note ID cannot be empty')
  }),

  getDocuments: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),

  getDocument: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  getDocumentChunks: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  getDocumentPage: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty'),
    pageNumber: z.number().int().min(1, 'Page number must be >= 1'),
    highlightText: z.string().optional()
  }),

  deleteDocument: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  reindexDocument: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  getStats: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),

  openSource: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  search: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    query: z
      .string()
      .min(1, 'Search query cannot be empty')
      .max(1000, 'Search query cannot exceed 1000 characters'),
    options: z
      .object({
        topK: z.number().int().min(1).max(100).optional(),
        threshold: z.number().min(0).max(1).optional(),
        includeContent: z.boolean().optional(),
        metadataFilter: z
          .object({
            documentIds: z.array(z.string().min(1)).optional(),
            documentTypes: z.array(z.enum(['file', 'note', 'text'])).optional(),
            sourceUriContains: z.string().min(1).max(500).optional()
          })
          .optional(),
        rerank: z
          .object({
            enabled: z.boolean().optional(),
            topN: z.number().int().min(1).max(100).optional(),
            model: z.string().min(1).max(300).optional(),
            heuristicFallback: z.boolean().optional()
          })
          .optional()
      })
      .optional()
  })
}

/**
 * 聊天相关的验证 schemas
 */
export const ChatSchemas = {
  sendMessage: z.object({
    sessionId: z.string().min(1, 'Session ID cannot be empty'),
    content: z
      .string()
      .min(1, 'Message content cannot be empty')
      .max(10000, 'Message content cannot exceed 10000 characters')
  }),

  createSession: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    title: z.string().max(200, 'Title cannot exceed 200 characters')
  }),

  getChatSessions: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),

  getActiveSession: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),

  updateSessionTitle: z.object({
    sessionId: z.string().min(1, 'Session ID cannot be empty'),
    title: z.string().min(1, 'Title cannot be empty').max(200, 'Title cannot exceed 200 characters')
  }),

  deleteSession: z.object({
    sessionId: z.string().min(1, 'Session ID cannot be empty')
  }),

  getMessages: z.object({
    sessionId: z.string().min(1, 'Session ID cannot be empty')
  }),

  abortMessage: z.object({
    messageId: z.string().min(1, 'Message ID cannot be empty')
  })
}

/**
 * 验证函数包装器
 * 将 IPC handler 包装为自动验证参数的函数
 *
 * @param schema Zod schema
 * @param handler IPC handler 函数
 * @returns 包装后的 handler
 *
 * @example
 * ```ts
 * ipcMain.handle('create-notebook',
 *   validate(NotebookSchemas.createNotebook, async (args) => {
 *     return createNotebook(args.title, args.description)
 *   })
 * )
 * ```
 */
export function validate<TSchema extends z.ZodType, TResult>(
  schema: TSchema,
  handler: (args: z.infer<TSchema>) => Promise<TResult>
): (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<TResult> {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: any[]): Promise<TResult> => {
    try {
      if (args.length === 0) {
        throw new Error('IPC call missing arguments')
      }

      if (args.length > 1) {
        throw new Error(
          `IPC call error: expected a single object argument, but received ${args.length} arguments`
        )
      }

      const validatedArgs = schema.parse(args[0])
      return await handler(validatedArgs)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = `Validation failed: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        Logger.error('IPC Validation', errorMessage)
        throw new Error(errorMessage)
      }
      throw error
    }
  }
}

/**
 * S-03: Validation wrapper for handlers that need access to the IPC event
 * (e.g. streaming handlers that call event.sender.send)
 */
export function validateWithEvent<TSchema extends z.ZodType, TResult>(
  schema: TSchema,
  handler: (event: Electron.IpcMainInvokeEvent, args: z.infer<TSchema>) => Promise<TResult>
): (_event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<TResult> {
  return async (event: Electron.IpcMainInvokeEvent, ...args: any[]): Promise<TResult> => {
    try {
      if (args.length === 0) {
        throw new Error('IPC call missing arguments')
      }

      if (args.length > 1) {
        throw new Error(
          `IPC call error: expected a single object argument, but received ${args.length} arguments`
        )
      }

      const validatedArgs = schema.parse(args[0])
      return await handler(event, validatedArgs)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = `Validation failed: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
        Logger.error('IPC Validation', errorMessage)
        throw new Error(errorMessage)
      }
      throw error
    }
  }
}

/**
 * 验证单个参数
 * 适用于只有一个参数的简单 handler
 *
 * @param schema Zod schema
 * @param value 要验证的值
 * @returns Result 对象
 *
 * @example
 * ```ts
 * const result = validateParam(z.string().min(1), userId)
 * if (!result.success) {
 *   throw new Error(result.error.message)
 * }
 * ```
 */
export function validateParam<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
  try {
    const validated = schema.parse(value)
    return Ok(validated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
      return Err(new Error(`验证失败: ${errorMessage}`))
    }
    return Err(error instanceof Error ? error : new Error(String(error)))
  }
}
