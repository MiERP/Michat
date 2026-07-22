import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core'
import { LEGAL_JOB_STATUSES, LEGAL_NODE_TYPES, LEGAL_RELATION_TYPES } from '../../shared/types/legalReasoning'

/**
 * 笔记本表
 * 用于存储用户创建的笔记本
 */
export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按更新时间查询笔记本的性能
    updatedIdx: index('idx_notebooks_updated').on(table.updatedAt)
  })
)

/**
 * 聊天会话表
 * 用于存储每个笔记本下的聊天会话
 */
export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    //  session 相关字段
    summary: text('summary'), // （如果是生成的）
    totalTokens: integer('total_tokens').notNull().default(0), // 当前会话累计 token 数
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'), // 会话状态
    parentSessionId: text('parent_session_id').references(() => chatSessions.id, {
      onDelete: 'set null'
    }), // 指向上一个被切换的 session
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按笔记本查询会话的性能
    notebookIdx: index('idx_sessions_notebook').on(table.notebookId, table.updatedAt)
  })
)

/**
 * 聊天消息表
 * 存储每个会话中的所有消息（用户消息和AI回复）
 */
export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    reasoningContent: text('reasoning_content'), // DeepSeek Reasoner 推理过程内容
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按会话查询消息的性能
    sessionIdx: index('idx_messages_session').on(table.sessionId, table.createdAt)
  })
)

/**
 * TypeScript 类型导出（从 Drizzle Schema 推导）
 */
export type Notebook = typeof notebooks.$inferSelect
export type NewNotebook = typeof notebooks.$inferInsert

export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

/**
 * 笔记表
 * 存储每个笔记本下的笔记
 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按笔记本查询笔记的性能
    notebookIdx: index('idx_notes_notebook').on(table.notebookId, table.updatedAt)
  })
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

// ==================== RAG 相关表 ====================

/**
 * 知识库文档表
 * 存储上传的文档元信息（知识来源）
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', { enum: ['file', 'note', 'url', 'text'] }).notNull(),
    sourceUri: text('source_uri'), // 原始文件路径或 URL
    localFilePath: text('local_file_path'), // 本地拷贝文件路径
    sourceNoteId: text('source_note_id').references(() => notes.id, { onDelete: 'set null' }),
    content: text('content'), // 原始内容（可选存储）
    contentHash: text('content_hash'), // 内容哈希，用于检测变更
    mimeType: text('mime_type'), // 文件类型
    fileSize: integer('file_size'), // 文件大小（字节）
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
    status: text('status', { enum: ['pending', 'processing', 'indexed', 'failed'] })
      .notNull()
      .default('pending'),
    errorMessage: text('error_message'),
    chunkCount: integer('chunk_count').default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_documents_notebook').on(table.notebookId, table.updatedAt),
    statusIdx: index('idx_documents_status').on(table.status)
  })
)

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert

/**
 * 文档分块表
 * 存储分块后的文本内容（RAG 的最小知识单元）
 */
export const chunks = sqliteTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(), // 在文档中的顺序
    startOffset: integer('start_offset'), // 原文起始位置
    endOffset: integer('end_offset'), // 原文结束位置
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
    tokenCount: integer('token_count'), // token 估算值
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    documentIdx: index('idx_chunks_document').on(table.documentId),
    notebookIdx: index('idx_chunks_notebook').on(table.notebookId)
  })
)

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert

/**
 * 向量嵌入表（元数据）
 * 存储 chunk 的向量元信息，实际向量存储在 vec0 虚拟表中
 */
export const embeddings = sqliteTable(
  'embeddings',
  {
    id: text('id').primaryKey(),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    model: text('model').notNull(), // embedding 模型名称
    dimensions: integer('dimensions').notNull(), // 向量维度
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    chunkIdx: index('idx_embeddings_chunk').on(table.chunkId),
    notebookIdx: index('idx_embeddings_notebook').on(table.notebookId),
    modelIdx: index('idx_embeddings_model').on(table.model)
  })
)

export type Embedding = typeof embeddings.$inferSelect
export type NewEmbedding = typeof embeddings.$inferInsert
export const legalNodes = sqliteTable(
  'legal_nodes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    chunkId: text('chunk_id').references(() => chunks.id, { onDelete: 'cascade' }),
    nodeType: text('node_type', { enum: LEGAL_NODE_TYPES }).notNull(),
    canonicalKey: text('canonical_key').notNull(),
    label: text('label').notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull(),
    articleNumber: text('article_number'),
    clauseNumber: text('clause_number'),
    pointNumber: text('point_number'),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    identityIdx: uniqueIndex('idx_legal_nodes_identity').on(
      table.notebookId,
      table.nodeType,
      table.canonicalKey
    ),
    documentTypeIdx: index('idx_legal_nodes_document_type').on(table.documentId, table.nodeType),
    chunkIdx: index('idx_legal_nodes_chunk').on(table.chunkId),
    labelIdx: index('idx_legal_nodes_notebook_label').on(table.notebookId, table.label)
  })
)

export type LegalNode = typeof legalNodes.$inferSelect
export type NewLegalNode = typeof legalNodes.$inferInsert

export const legalRelations = sqliteTable(
  'legal_relations',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    sourceNodeId: text('source_node_id')
      .notNull()
      .references(() => legalNodes.id, { onDelete: 'cascade' }),
    targetNodeId: text('target_node_id')
      .notNull()
      .references(() => legalNodes.id, { onDelete: 'cascade' }),
    relationType: text('relation_type', { enum: LEGAL_RELATION_TYPES }).notNull(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    evidenceChunkId: text('evidence_chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    evidenceText: text('evidence_text').notNull(),
    evidenceStartOffset: integer('evidence_start_offset').notNull(),
    evidenceEndOffset: integer('evidence_end_offset').notNull(),
    confidence: real('confidence').notNull(),
    qualifiers: text('qualifiers', { mode: 'json' }).$type<Record<string, unknown>>(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    ontologyVersion: text('ontology_version').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    fingerprintIdx: uniqueIndex('idx_legal_relations_fingerprint').on(
      table.notebookId,
      table.fingerprint
    ),
    sourceTypeIdx: index('idx_legal_relations_source_type').on(
      table.sourceNodeId,
      table.relationType
    ),
    targetTypeIdx: index('idx_legal_relations_target_type').on(
      table.targetNodeId,
      table.relationType
    ),
    documentIdx: index('idx_legal_relations_document').on(table.documentId),
    evidenceChunkIdx: index('idx_legal_relations_evidence_chunk').on(table.evidenceChunkId),
    confidenceCheck: check(
      'legal_relations_confidence_check',
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
    )
  })
)

export type LegalRelation = typeof legalRelations.$inferSelect
export type NewLegalRelation = typeof legalRelations.$inferInsert

export const legalExtractionJobs = sqliteTable(
  'legal_extraction_jobs',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    status: text('status', { enum: LEGAL_JOB_STATUSES }).notNull().default('pending'),
    extractorVersion: text('extractor_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    ontologyVersion: text('ontology_version').notNull(),
    model: text('model'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    sourceUnitCount: integer('source_unit_count').notNull().default(0),
    processedUnitCount: integer('processed_unit_count').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
    nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    documentIdx: uniqueIndex('idx_legal_extraction_jobs_document').on(table.documentId),
    statusNextRunIdx: index('idx_legal_extraction_jobs_status_next_run').on(
      table.status,
      table.nextRunAt
    ),
    notebookStatusIdx: index('idx_legal_extraction_jobs_notebook_status').on(
      table.notebookId,
      table.status
    )
  })
)

export type LegalExtractionJob = typeof legalExtractionJobs.$inferSelect
export type NewLegalExtractionJob = typeof legalExtractionJobs.$inferInsert


/**
 * Notebook Overview table
 * Stores user-triggered cross-document synthesis.
 */
export const notebookOverviews = sqliteTable(
  'notebook_overviews',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    citations: text('citations', { mode: 'json' }).notNull().$type<Record<string, unknown>[]>(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    status: text('status', { enum: ['fresh', 'stale'] })
      .notNull()
      .default('fresh'),
    model: text('model'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookUnique: uniqueIndex('idx_notebook_overviews_notebook').on(table.notebookId)
  })
)

export type NotebookOverviewRecord = typeof notebookOverviews.$inferSelect
export type NewNotebookOverviewRecord = typeof notebookOverviews.$inferInsert

/**
 * 思维导图表
 * 存储笔记本的派生知识结构
 */
export const mindMaps = sqliteTable(
  'mind_maps',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 版本号
    treeData: text('tree_data', { mode: 'json' }).notNull(), // 树结构
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // 节点ID -> chunk IDs映射
    metadata: text('metadata', { mode: 'json' }).$type<{
      model: string
      totalNodes: number
      maxDepth: number
      generationTime: number
    }>(),
    status: text('status', { enum: ['generating', 'completed', 'failed'] })
      .notNull()
      .default('generating'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_mindmaps_notebook').on(table.notebookId, table.updatedAt),
    versionIdx: index('idx_mindmaps_version').on(table.notebookId, table.version)
  })
)

export type MindMap = typeof mindMaps.$inferSelect
export type NewMindMap = typeof mindMaps.$inferInsert

/**
 * 题库表
 * 存储笔记本的答题题库
 */
export const quizzes = sqliteTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // 版本号
    questionsData: text('questions_data', { mode: 'json' }).notNull(), // 题目数组
    chunkMapping: text('chunk_mapping', { mode: 'json' }).notNull(), // questionId -> chunkIds映射
    metadata: text('metadata', { mode: 'json' }).$type<{
      model: string
      totalQuestions: number
      generationTime: number
    }>(),
    status: text('status', { enum: ['generating', 'completed', 'failed'] })
      .notNull()
      .default('generating'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_quizzes_notebook').on(table.notebookId, table.updatedAt),
    versionIdx: index('idx_quizzes_version').on(table.notebookId, table.version)
  })
)

export type Quiz = typeof quizzes.$inferSelect
export type NewQuiz = typeof quizzes.$inferInsert

/**
 * 答题会话表
 * 存储用户的答题记录
 */
export const quizSessions = sqliteTable(
  'quiz_sessions',
  {
    id: text('id').primaryKey(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    answers: text('answers', { mode: 'json' }).$type<Record<string, number>>(), // questionId -> answerIndex
    score: integer('score'),
    totalQuestions: integer('total_questions').notNull(),
    correctCount: integer('correct_count'),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    quizIdx: index('idx_quiz_sessions_quiz').on(table.quizId, table.createdAt),
    notebookIdx: index('idx_quiz_sessions_notebook').on(table.notebookId, table.createdAt)
  })
)

export type QuizSession = typeof quizSessions.$inferSelect
export type NewQuizSession = typeof quizSessions.$inferInsert

/**
 * Items 表
 * 统一管理笔记本下的所有内容项（笔记、思维导图、PPT、音频等）
 */
export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['note', 'mindmap', 'quiz', 'ppt', 'audio', 'video'] }).notNull(),
    resourceId: text('resource_id').notNull(), // 指向实际资源的 ID (notes.id, mindMaps.id 等)
    order: integer('order').notNull().default(0), // 排序，数值越小越靠前
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // 优化按笔记本查询并排序的性能
    notebookOrderIdx: index('idx_items_notebook_order').on(table.notebookId, table.order),
    // 优化按类型查询的性能
    typeIdx: index('idx_items_type').on(table.type),
    // 优化按资源 ID 查找对应 item 的性能
    resourceIdx: index('idx_items_resource').on(table.type, table.resourceId)
  })
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
