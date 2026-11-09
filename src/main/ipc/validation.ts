/**
 * IPC 参数验证
 * 使用 Zod 进行运行时类型验证，防止注入攻击和无效数据
 */

import { z } from 'zod'
import { Result, Err, Ok } from '../../shared/types/result'
import Logger from '../../shared/utils/logger'

const promptLanguageSchema = z.object({
  'vi-VN': z.string().optional(),
  'en-US': z.string().optional()
})

const promptsSchema = z.object({
  quiz: promptLanguageSchema.optional(),
  chat: promptLanguageSchema.optional()
})

const appSettingsUpdateSchema = z
  .object({
    theme: z.enum(['light', 'dark']).optional(),
    language: z.enum(['vi-VN', 'en-US']).optional(),
    autoLaunch: z.boolean().optional(),
    hasCompletedOnboarding: z.boolean().optional(),
    defaultChatModel: z.string().optional(),
    defaultEmbeddingModel: z.string().optional(),
    rerankEnabled: z.boolean().optional(),
    rerankTopN: z.number().int().min(1).max(100).optional(),
    rerankUseHeuristicFallback: z.boolean().optional(),
    ragTopK: z.number().int().min(1).max(50).optional(),
    ragThreshold: z.number().min(0).max(1).optional(),
    ragSkipShortQueryLength: z.number().int().min(0).max(200).optional(),
    ragEnableChitChatHeuristic: z.boolean().optional(),
    ragHierarchicalEnabled: z.boolean().optional(),
    ragDocTopK: z.number().int().min(1).max(50).optional(),
    ragMetadataAwareEnabled: z.boolean().optional(),
    ragRetrievalDebugEnabled: z.boolean().optional(),
    prompts: promptsSchema.optional()
  })
  .strict()

const settingValueSchemas = {
  theme: appSettingsUpdateSchema.shape.theme.unwrap(),
  language: appSettingsUpdateSchema.shape.language.unwrap(),
  autoLaunch: appSettingsUpdateSchema.shape.autoLaunch.unwrap(),
  hasCompletedOnboarding: appSettingsUpdateSchema.shape.hasCompletedOnboarding.unwrap(),
  defaultChatModel: appSettingsUpdateSchema.shape.defaultChatModel.unwrap(),
  defaultEmbeddingModel: appSettingsUpdateSchema.shape.defaultEmbeddingModel.unwrap(),
  rerankEnabled: appSettingsUpdateSchema.shape.rerankEnabled.unwrap(),
  rerankTopN: appSettingsUpdateSchema.shape.rerankTopN.unwrap(),
  rerankUseHeuristicFallback: appSettingsUpdateSchema.shape.rerankUseHeuristicFallback.unwrap(),
  ragTopK: appSettingsUpdateSchema.shape.ragTopK.unwrap(),
  ragThreshold: appSettingsUpdateSchema.shape.ragThreshold.unwrap(),
  ragSkipShortQueryLength: appSettingsUpdateSchema.shape.ragSkipShortQueryLength.unwrap(),
  ragEnableChitChatHeuristic: appSettingsUpdateSchema.shape.ragEnableChitChatHeuristic.unwrap(),
  ragHierarchicalEnabled: appSettingsUpdateSchema.shape.ragHierarchicalEnabled.unwrap(),
  ragDocTopK: appSettingsUpdateSchema.shape.ragDocTopK.unwrap(),
  ragMetadataAwareEnabled: appSettingsUpdateSchema.shape.ragMetadataAwareEnabled.unwrap(),
  ragRetrievalDebugEnabled: appSettingsUpdateSchema.shape.ragRetrievalDebugEnabled.unwrap(),
  prompts: appSettingsUpdateSchema.shape.prompts.unwrap()
}

const settingKeys = Object.keys(settingValueSchemas) as [
  keyof typeof settingValueSchemas,
  ...Array<keyof typeof settingValueSchemas>
]
const settingKeySchema = z.enum(settingKeys)

/**
 * Settings validation schemas
 */
export const SettingsSchemas = {
  get: z.object({
    key: settingKeySchema
  }),

  set: z
    .object({
      key: settingKeySchema,
      value: z.unknown()
    })
    .superRefine((args, ctx) => {
      const result = settingValueSchemas[args.key].safeParse(args.value)
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: result.error.issues.map((issue) => issue.message).join(', ')
        })
      }
    }),

  update: z.object({
    updates: appSettingsUpdateSchema
  })
}

/**
 * Notebook validation schemas
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

const providerConfigSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    embeddingBaseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    models: z.array(z.string()).optional()
  })
  .passthrough()

/**
 * Provider validation schemas
 */
export const ProviderSchemas = {
  saveProviderConfig: z.object({
    providerName: z.string().min(1, { message: 'Provider name cannot be empty' }),
    config: providerConfigSchema,
    enabled: z.boolean(),
    clearApiKey: z.boolean().optional()
  }),

  getProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty')
  }),

  deleteProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty')
  }),

  validateProviderConfig: z.object({
    providerName: z.string().min(1, 'Provider name cannot be empty'),
    config: providerConfigSchema
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
const documentMetadataSchema = z.object({
  documentNumber: z.string().trim().max(200).optional(),
  documentType: z.string().trim().max(200).optional(),
  issuer: z.string().trim().max(500).optional(),
  issuedAt: z.iso.date().optional(),
  documentTitle: z.string().trim().max(2000).optional(),
  legalBases: z.string().trim().max(12000).optional()
})

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

  addDocumentFromUrl: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    url: z.url().max(4096)
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

  updateDocumentMetadata: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty'),
    metadata: documentMetadataSchema
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

  enrichDocument: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),
  notebookSummary: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),
  refreshDocumentMetadata: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  getStats: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty')
  }),

  openSource: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  recordFeedback: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    chunkId: z.string().min(1, 'Chunk ID cannot be empty'),
    kind: z.enum(['citation_good', 'citation_bad', 'user_correction']),
    note: z.string().optional()
  }),

  setDocumentLifecycle: z.object({
    documentId: z.string().min(1, 'Document ID cannot be empty'),
    state: z.enum(['draft', 'verified', 'outdated'])
  }),

  getLinks: z.object({
    notebookId: z.string().min(1, 'Notebook ID cannot be empty'),
    documentId: z.string().min(1, 'Document ID cannot be empty')
  }),

  generateLinks: z.object({
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
            documentTypes: z.array(z.enum(['file', 'note', 'url', 'text', 'memory'])).optional(),
            sourceUriContains: z.string().min(1).max(500).optional(),
            sectionPath: z.array(z.string().min(1).max(300)).max(10).optional(),
            pageRange: z
              .object({
                from: z.number().int().min(1),
                to: z.number().int().min(1)
              })
              .optional(),
            documentMetadata: z.record(z.string().max(100), z.string().max(300)).optional()
          })
          .optional(),
        hierarchical: z
          .object({
            enabled: z.boolean().optional(),
            docTopK: z.number().int().min(1).max(50).optional(),
            sectionTopK: z.number().int().min(1).max(50).optional(),
            threshold: z.number().min(0).max(1).optional()
          })
          .optional(),
        rerank: z
          .object({
            enabled: z.boolean().optional(),
            topN: z.number().int().min(1).max(100).optional(),
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
      .max(10000, 'Message content cannot exceed 10000 characters'),
    // Phạm vi tri thức cho lượt hỏi (đúng tài liệu → đúng mục → đúng khoảng trang)
    scope: z
      .object({
        documentIds: z.array(z.string().min(1)).max(50).optional(),
        sectionPath: z.array(z.string().min(1).max(300)).max(10).optional(),
        pageRange: z
          .object({
            from: z.number().int().min(1),
            to: z.number().int().min(1)
          })
          .optional()
      })
      .optional()
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

/** Reject IPC calls from frames that are not part of the app. */
function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url
  if (!url) return
  const trusted =
    url.startsWith('file://') ||
    url.startsWith('app://') ||
    url.startsWith('http://localhost:') ||
    url.startsWith('http://127.0.0.1:')
  if (!trusted) {
    throw new Error(`Untrusted IPC sender: ${url}`)
  }
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
      assertTrustedSender(_event)
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
      assertTrustedSender(event)
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
 * Wrapper for handlers that intentionally take no arguments.
 */
export function validateNoArgs<TResult>(
  handler: (event: Electron.IpcMainInvokeEvent) => Promise<TResult>
): (event: Electron.IpcMainInvokeEvent) => Promise<TResult> {
  return async (event: Electron.IpcMainInvokeEvent): Promise<TResult> => {
    assertTrustedSender(event)
    return handler(event)
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
