import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import type { ChatMessageMetadata } from '../../shared/types/chat'
import type { QuizQuestion } from '../../shared/types/quiz'

/**
 * JSON metadata stored on notebooks and documents. Values are deliberately
 * untyped because each feature owns its own metadata shape and consumers
 * narrow the fields they read.
 */
type JsonMetadata = Record<string, unknown>

/**
 * Notebooks table
 * Stores notebooks created by the user
 */
export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    /** JSON: chứa notebookSummary (tóm tắt thống nhất notebook) và metadata khác. */
    metadata: text('metadata', { mode: 'json' }).$type<JsonMetadata>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // Speeds up notebook lookups ordered by update time
    updatedIdx: index('idx_notebooks_updated').on(table.updatedAt)
  })
)

/**
 * Chat sessions table
 * Stores the chat sessions belonging to each notebook
 */
export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    //  Session-related fields
    summary: text('summary'), // (if generated)
    totalTokens: integer('total_tokens').notNull().default(0), // cumulative token count for this session
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'), // session status
    parentSessionId: text('parent_session_id').references(() => chatSessions.id, {
      onDelete: 'set null'
    }), // points to the previously active session
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // Speeds up session lookups by notebook
    notebookIdx: index('idx_sessions_notebook').on(table.notebookId, table.updatedAt)
  })
)

/**
 * Chat messages table
 * Stores every message in each session (user messages and AI replies)
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
    reasoningContent: text('reasoning_content'), // DeepSeek Reasoner chain-of-thought content
    metadata: text('metadata', { mode: 'json' }).$type<ChatMessageMetadata>(),
    /** User rating on an assistant answer; kept for answer-quality datasets. */
    feedback: text('feedback', { enum: ['like', 'dislike'] }),
    feedbackAt: integer('feedback_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // Speeds up message lookups by session
    sessionIdx: index('idx_messages_session').on(table.sessionId, table.createdAt)
  })
)

/**
 * TypeScript type exports (inferred from the Drizzle schema)
 */
export type Notebook = typeof notebooks.$inferSelect
export type NewNotebook = typeof notebooks.$inferInsert

export type ChatSession = typeof chatSessions.$inferSelect
export type NewChatSession = typeof chatSessions.$inferInsert

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

/**
 * Notes table
 * Stores the notes belonging to each notebook
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
    // Speeds up note lookups by notebook
    notebookIdx: index('idx_notes_notebook').on(table.notebookId, table.updatedAt)
  })
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

// ==================== RAG-related tables ====================

/**
 * Knowledge base documents table
 * Stores metadata for uploaded documents (knowledge sources)
 */
export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', { enum: ['file', 'note', 'url', 'text', 'memory'] }).notNull(),
    sourceUri: text('source_uri'), // original file path or URL
    localFilePath: text('local_file_path'), // path of the local copy
    sourceNoteId: text('source_note_id').references(() => notes.id, { onDelete: 'set null' }),
    memoryOfSessionId: text('memory_of_session_id'), // memory: session nguồn của ký ức
    content: text('content'), // raw content (optionally stored)
    contentHash: text('content_hash'), // content hash used to detect changes
    contentMdHash: text('content_md_hash'), // markdown chuẩn hóa (canonical) hash — phát hiện thay đổi do normalizer
    mimeType: text('mime_type'), // file type
    fileSize: integer('file_size'), // file size in bytes
    metadata: text('metadata', { mode: 'json' }).$type<JsonMetadata>(),
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
    statusIdx: index('idx_documents_status').on(table.status),
    memoryIdx: index('idx_documents_memory_session').on(table.memoryOfSessionId)
  })
)

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert

/** Queryable projection of document metadata. JSON remains the source of truth. */
export const documentMetadataValues = sqliteTable(
  'document_metadata_values',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    valueNormalized: text('value_normalized').notNull(),
    valueDisplay: text('value_display').notNull(),
    source: text('source').notNull().default('extractor'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    lookupIdx: index('idx_document_metadata_lookup').on(
      table.notebookId,
      table.field,
      table.valueNormalized
    ),
    documentIdx: index('idx_document_metadata_document').on(table.documentId)
  })
)

/**
 * Document chunks table
 * Stores the chunked text content (the smallest knowledge unit in RAG)
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
    contentHash: text('content_hash'), // block hash (md5 nội dung chunk) — cho incremental reindex
    chunkIndex: integer('chunk_index').notNull(), // position within the document
    startOffset: integer('start_offset'), // start position in the source text
    endOffset: integer('end_offset'), // end position in the source text
    metadata: text('metadata', { mode: 'json' }).$type<JsonMetadata>(),
    tokenCount: integer('token_count'), // estimated token count
    sectionId: text('section_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    documentIdx: index('idx_chunks_document').on(table.documentId),
    notebookIdx: index('idx_chunks_notebook').on(table.notebookId),
    sectionIdx: index('idx_chunks_section').on(table.sectionId),
    documentHashIdx: index('idx_chunks_document_hash').on(table.documentId, table.contentHash)
  })
)

export type Chunk = typeof chunks.$inferSelect
export type NewChunk = typeof chunks.$inferInsert

/**
 * Bảng mục (section) — tầng giữa của Hierarchical Retrieval.
 * Mỗi hàng là một heading (kèm headingPath) trích từ structured Markdown/Word,
 * giữ content nguyên văn của mục để embed và để mở rộng context kiểu
 * document → section → chunk.
 */
export const sections = sqliteTable(
  'sections',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    headingPath: text('heading_path', { mode: 'json' }).$type<string[]>().notNull(),
    title: text('title').notNull(),
    level: integer('level').notNull().default(1),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    chunkCount: integer('chunk_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    documentIdx: index('idx_sections_document').on(table.documentId)
  })
)

export type Section = typeof sections.$inferSelect
export type NewSection = typeof sections.$inferInsert

/**
 * Vector embeddings table (metadata)
 * Stores vector metadata for each chunk; the actual vectors live in the vec0 virtual table
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
    model: text('model').notNull(), // embedding model name
    dimensions: integer('dimensions').notNull(), // vector dimensions
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

/**
 * Liên kết tri thức giữa các document/chunk (knowledge graph nhẹ)
 * Được sinh tự động khi generate-links hoặc qua background queue.
 */
export const knowledgeLinks = sqliteTable(
  'knowledge_links',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    sourceDocumentId: text('source_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    targetDocumentId: text('target_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    sourceChunkId: text('source_chunk_id').references(() => chunks.id, {
      onDelete: 'cascade'
    }),
    targetChunkId: text('target_chunk_id').references(() => chunks.id, {
      onDelete: 'cascade'
    }),
    relationType: text('relation_type', { enum: ['related', 'extends', 'contradicts'] })
      .notNull()
      .default('related'),
    confidence: real('confidence').notNull().default(0.5),
    evidence: text('evidence'), // keyword/entity dùng làm bằng chứng liên kết
    status: text('status', { enum: ['active', 'decayed', 'removed'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    notebookIdx: index('idx_links_notebook').on(table.notebookId, table.status),
    sourceIdx: index('idx_links_source').on(table.sourceDocumentId),
    targetIdx: index('idx_links_target').on(table.targetDocumentId)
  })
)

export type KnowledgeLink = typeof knowledgeLinks.$inferSelect
export type NewKnowledgeLink = typeof knowledgeLinks.$inferInsert

/**
 * Phản hồi của người dùng lên chunk (feedback loop)
 * Dùng để boost/penalty chunk khi retrieval.
 */
export const chunkFeedback = sqliteTable(
  'chunk_feedback',
  {
    id: text('id').primaryKey(),
    chunkId: text('chunk_id')
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['citation_good', 'citation_bad', 'user_correction'] }).notNull(),
    note: text('note'), // ghi chú/nội dung sửa của người dùng
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    chunkIdx: index('idx_feedback_chunk').on(table.chunkId),
    notebookIdx: index('idx_feedback_notebook').on(table.notebookId)
  })
)

export type ChunkFeedback = typeof chunkFeedback.$inferSelect
export type NewChunkFeedback = typeof chunkFeedback.$inferInsert

/**
 * Hàng đợi job nền (background queue)
 * Cho các tác vụ "học liên tục": auto-link, decay, reindex, consolidate...
 * Chạy tuần tự khi app idle, task của user luôn ưu tiên.
 */
export const backgroundJobs = sqliteTable(
  'background_jobs',
  {
    id: text('id').primaryKey(),
    jobType: text('job_type', {
      enum: [
        'generate-links',
        'decay-links',
        'reindex-document',
        'enrich-document',
        'summarize-notebook',
        'rebuild-vectors',
        'backfill-knowledge',
        'memory-consolidate'
      ]
    }).notNull(),
    notebookId: text('notebook_id'),
    documentId: text('document_id'),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(2),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    retryAt: integer('retry_at', { mode: 'timestamp' })
  },
  (table) => ({
    statusIdx: index('idx_jobs_status').on(table.status, table.createdAt)
  })
)

export type BackgroundJob = typeof backgroundJobs.$inferSelect
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert

/**
 * Quizzes table
 * Stores the quiz question bank for a notebook
 */
export const quizzes = sqliteTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1), // version number
    questionsData: text('questions_data', { mode: 'json' }).$type<QuizQuestion[]>().notNull(), // array of questions
    chunkMapping: text('chunk_mapping', { mode: 'json' })
      .$type<Record<string, string[]>>()
      .notNull(), // questionId -> chunkIds mapping
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
 * Quiz sessions table
 * Stores the user's quiz attempts
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
 * Items table
 * Manages all content items under a notebook (notes, quizzes, PPT, audio, etc.)
 */
export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['note', 'quiz', 'ppt', 'audio', 'video'] }).notNull(),
    resourceId: text('resource_id').notNull(), // ID of the backing resource (notes.id, quizzes.id, etc.)
    order: integer('order').notNull().default(0), // sort order; lower values come first
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
  },
  (table) => ({
    // Speeds up notebook lookups with ordering
    notebookOrderIdx: index('idx_items_notebook_order').on(table.notebookId, table.order),
    // Speeds up lookups by type
    typeIdx: index('idx_items_type').on(table.type),
    // Speeds up finding an item by resource ID
    resourceIdx: index('idx_items_resource').on(table.type, table.resourceId)
  })
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
