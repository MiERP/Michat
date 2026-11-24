/**
 * QuizService
 * Quiz service - generates and manages quiz banks for notebooks
 */

import { randomUUID } from 'crypto'
import { getDatabase, executeCheckpoint } from '../db'
import {
  quizzes,
  documents,
  chunks,
  notebooks,
  items,
  quizSessions,
  chunkFeedback
} from '../db/schema'
import type { Quiz, NewQuiz, QuizSession, NewQuizSession, NewChunkFeedback } from '../db/schema'
import type { KnowledgeService } from './KnowledgeService'
import type { QuizQuestion, QuizGenerationResult } from '../../shared/types/quiz'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ApiClient } from '../ai/apiClient'
import { OpenAICompatibleClient } from '../ai/OpenAICompatibleClient'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { estimateTokens } from '../../shared/utils/tokenEstimate'
import { parseQuizPayload, sanitizeQuizQuestions } from './quizPayload'
import { settingsManager } from '../config'

/**
 * Progress callback function type
 */
export type QuizProgressCallback = (stage: string, progress: number) => void

const MAX_SOURCE_DOCS = 10
const MAX_CHUNKS_PER_DOC = 4
const MAX_CHARS_PER_CHUNK = 600
const MAX_PROMPT_CONTENT_CHARS = 10000
const BATCH_SIZE = 5
const MAX_BATCHES = 4
// Model 4B+ trên CPU sinh chậm, nhưng timeout phải ngắn + huỷ được request
// để user không chờ vô hạn; retry ở tầng batch bên dưới.
// Model local (đặc biệt 4B+ trên CPU) có thể cần vài phút cho một batch.
// Cho phép override để môi trường nhanh/chậm tự chỉnh.
const GENERATION_TIMEOUT_MS = Number(process.env.KN_QUIZ_TIMEOUT_MS) || 600000
// Giới hạn output: một batch ~5 câu không cần quá 4k token
const MAX_OUTPUT_TOKENS = 4096

type QualityMode = 'fast' | 'balanced' | 'accurate'

function getQualityMode(): QualityMode {
  const mode = (process.env.KN_GEN_QUALITY || 'balanced').toLowerCase()
  if (mode === 'fast' || mode === 'accurate') return mode
  return 'balanced'
}

/**
 * Hẹn giờ cho promise generation kèm AbortSignal — khi hết giờ, huỷ luôn
 * request đang chạy để API không tiếp tục ngốn slot (gây xếp hàng).
 */
function withAbortTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Generation timed out — model may be overloaded'))
    }, ms)
    fn(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Quiz generation options
 */
export interface QuizGenerationOptions {
  questionCount?: number // Number of questions, defaults to 10
  difficulty?: 'easy' | 'medium' | 'hard' // Difficulty, defaults to medium
  customPrompt?: string // Custom prompt
  documentIds?: string[] // Generate from specific documents only; empty = all documents
}

/**
 * Get the quiz generation prompt (supports i18n and custom prompts) — also returns
 * the language so the correct difficulty instruction is attached.
 */
async function getQuizPrompt(customPrompt?: string): Promise<{ prompt: string; language: string }> {
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'vi-VN'

  // If a custom prompt is provided, use it directly
  if (customPrompt && customPrompt.trim()) {
    return { prompt: customPrompt.trim(), language }
  }

  const prompt = settings.prompts?.quiz?.[language]
  if (!prompt) {
    throw new Error(`No quiz generation prompt found for language ${language}`)
  }

  return { prompt, language }
}

/**
 * Get the difficulty instruction text
 */
function getDifficultyInstruction(
  difficulty: 'easy' | 'medium' | 'hard',
  language: string
): string {
  const difficultyInstructions = {
    easy: {
      'vi-VN':
        'Difficulty: Easy - Generate easy-difficulty questions that focus on basic concepts and definitions. Options should have clear differences.',
      'en-US':
        'Difficulty: Easy - Generate easy-difficulty questions that focus on basic concepts and definitions. Options should have clear differences.'
    },
    medium: {
      'vi-VN':
        'Difficulty: Medium - Generate medium-difficulty questions that require understanding and applying knowledge points, with moderately similar options.',
      'en-US':
        'Difficulty: Medium - Generate medium-difficulty questions that require understanding and applying knowledge points, with moderately similar options.'
    },
    hard: {
      'vi-VN':
        'Difficulty: Hard - Generate hard-difficulty questions that require deep understanding, comprehensive application, and analytical ability. Options should be somewhat confusing.',
      'en-US':
        'Difficulty: Hard - Generate hard-difficulty questions that require deep understanding, comprehensive application, and analytical ability. Options should be somewhat confusing.'
    }
  }

  return difficultyInstructions[difficulty][language] || difficultyInstructions[difficulty]['vi-VN']
}

/**
 * Zod schema defining the quiz structure
 */
const QuizQuestionSchema: z.ZodType<QuizQuestion> = z.object({
  id: z.string().describe('Unique question ID'),
  questionText: z.string().max(500).describe('Question text'),
  options: z.array(z.string().max(200)).length(4).describe('4 options'),
  correctAnswer: z.number().min(0).max(3).describe('Correct answer index (0-3)'),
  explanation: z.string().max(500).default('').describe('Answer explanation'),
  hints: z.array(z.string().max(200)).max(2).default([]).describe('1-2 hints'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('Related chunk ID list')
    })
    .optional()
})

/**
 * Create the dynamic quiz schema
 */
function createQuizSchema(questionCount: number) {
  return z.object({
    // Chấp nhận ít hơn yêu cầu thay vì ép validation lỗi phải sinh lại toàn bộ
    // (một lần sinh trên CPU local có thể mất nhiều phút).
    questions: z.array(QuizQuestionSchema).min(1).max(questionCount).describe('Question array'),
    metadata: z
      .object({
        totalQuestions: z.number().describe('Total question count')
      })
      .optional()
  })
}

/**
 * Quiz service
 */
export class QuizService {
  constructor(
    private apiClient: ApiClient,
    private knowledgeService: KnowledgeService,
    private getChatContextSize?: () => number
  ) {}

  private contextSize(): number {
    return this.getChatContextSize?.() ?? 8192
  }

  /** Nhỏ hơn cho model context 8k để prompt + output không vượt n_ctx. */
  private contentCharCap(): number {
    return this.contextSize() <= 8192 ? 5000 : MAX_PROMPT_CONTENT_CHARS
  }

  /**
   * Aggregate notebook content — read through KnowledgeService (shared pipeline)
   * instead of querying the documents/chunks tables directly.
   */
  private trimChunkContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_CHUNK)
  }

  private async aggregateNotebookContent(
    notebookId: string,
    documentIds?: string[]
  ): Promise<string> {
    const mode = getQualityMode()
    const docsLimit = mode === 'fast' ? 6 : mode === 'accurate' ? 12 : MAX_SOURCE_DOCS
    const chunksPerDoc = mode === 'fast' ? 3 : mode === 'accurate' ? 6 : MAX_CHUNKS_PER_DOC

    try {
      const docsWithChunks = this.knowledgeService.getIndexedDocumentsWithChunks(notebookId, {
        documentIds,
        docsLimit,
        chunksPerDoc,
        spreadChunks: true
      })

      Logger.info(
        'QuizService',
        `Found ${docsWithChunks.length} indexed documents (scope=${documentIds && documentIds.length > 0 ? 'selected' : 'all'})`
      )

      if (docsWithChunks.length === 0) {
        throw new Error(
          'The notebook has no content available to generate questions; add documents to the knowledge base first'
        )
      }

      const contentParts = docsWithChunks.map((doc) => {
        const chunkContent = doc.chunks
          .map((c) => `[chunk:${c.id}] ${this.trimChunkContent(c.content)}`)
          .join('\n')
        return `[Document: ${doc.title}]\n${chunkContent}`
      })

      let mergedContent = contentParts.join('\n\n---\n\n')
      const contentCap = this.contentCharCap()
      if (mergedContent.length > contentCap) {
        mergedContent = mergedContent.slice(0, contentCap)
      }

      return mergedContent
    } catch (error) {
      Logger.error('QuizService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * Call the LLM to generate questions (runs batches sequentially — streamObject
   * reports progress and allows cancellation on timeout; batches do not run in
   * parallel because the local API is single-slot, so parallel batches
   * would only queue behind each other).
   */
  private async callLLMForGeneration(
    content: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<QuizGenerationResult> {
    const provider = await this.apiClient.getChatProvider()
    if (!provider) {
      throw new Error('No chat model available, please configure an LLM provider first')
    }

    if (!(provider instanceof OpenAICompatibleClient)) {
      throw new Error('The current provider does not support structured output')
    }

    Logger.info('QuizService', `Using provider: ${provider.name}`)

    const { prompt: promptTemplate, language } = await getQuizPrompt(options?.customPrompt)
    const questionCount = Math.min(Math.max(options?.questionCount || 10, 3), 20)
    const difficulty = options?.difficulty || 'medium'
    const difficultyInstruction = getDifficultyInstruction(difficulty, language)

    const model = provider.getAIModel()
    const mode = getQualityMode()
    // Một lần sinh đã tốn nhiều phút; retry chỉ nhân thời gian chờ. Chỉ mode
    // accurate được retry (1 lần), balanced/fast không retry batch.
    // A parse failure is cheap to retry compared with losing the whole quiz;
    // only "fast" mode keeps a single attempt.
    const maxAttempts = mode === 'fast' ? 1 : 2

    const maxBatchesByMode = { fast: 1, balanced: 2, accurate: 4 } as const
    const desiredBatches = Math.min(
      Math.ceil(questionCount / BATCH_SIZE),
      maxBatchesByMode[mode],
      MAX_BATCHES
    )
    const contentParts = this.splitContentIntoParts(content, desiredBatches)
    const batchCount = Math.max(1, contentParts.length)

    const baseCount = Math.floor(questionCount / batchCount)
    const remainder = questionCount % batchCount

    const batches = Array.from({ length: batchCount }, (_, i) => {
      const count = Math.max(1, baseCount + (i < remainder ? 1 : 0))
      return { contentPart: contentParts[i] ?? contentParts[0], count }
    })

    onProgress?.('generating_quiz', 30)

    const results: QuizQuestion[][] = []
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const batchStart = 30 + Math.round((i / batchCount) * 40)
      const batchEnd = 30 + Math.round(((i + 1) / batchCount) * 40)
      let partialTicks = 0

      const questions = await this.generateQuestionsBatch(
        model,
        promptTemplate,
        batch.contentPart,
        batch.count,
        difficultyInstruction,
        maxAttempts,
        () => {
          partialTicks++
          if (partialTicks % 5 === 0) {
            onProgress?.(
              'generating_quiz',
              Math.min(batchStart + Math.round(partialTicks * 0.5), batchEnd)
            )
          }
        }
      )
      results.push(questions)
      onProgress?.('generating_quiz', Math.min(batchEnd, 70))
    }

    onProgress?.('parsing_result', 70)

    const questions = results.flat()
    return {
      questions,
      metadata: { totalQuestions: questions.length }
    }
  }

  /**
   * Generate a single batch of questions (with independent retry)
   */
  private async generateQuestionsBatch(
    model: LanguageModel,
    promptTemplate: string,
    contentPart: string,
    questionCount: number,
    difficultyInstruction: string,
    maxAttempts: number,
    onPartialProgress?: () => void
  ): Promise<QuizQuestion[]> {
    const BatchSchema = createQuizSchema(questionCount)
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const correction =
        attempt === 1
          ? ''
          : '\n\nLƯU Ý: lần trước JSON không hợp lệ. Hãy trả về JSON hợp lệ, đủ số câu, mỗi câu 4 lựa chọn và đúng 1 đáp án.'

      const contextSize = this.contextSize()
      const buildPrompt = (part: string): string => {
        let next = promptTemplate.replace(/\{\{QUESTION_COUNT\}\}/g, questionCount.toString())
        next = next.replace(/\{\{DIFFICULTY_INSTRUCTION\}\}/g, difficultyInstruction)
        next = next.replace(/\{\{CONTENT\}\}/g, part)
        return `${next}${correction}\n\nChỉ trả về một đối tượng JSON hợp lệ theo đúng định dạng trên; không markdown, không giải thích, không thêm chữ nào khác.`
      }

      // Keep the prompt inside the model context; otherwise the API rejects
      // the whole request (or generates nothing) on 8k-context models.
      let contentForBatch = contentPart
      let prompt = buildPrompt(contentForBatch)
      let promptTokens = estimateTokens(prompt)
      for (let trim = 0; trim < 4 && promptTokens > contextSize - 1024; trim++) {
        if (contentForBatch.length <= 500) break
        contentForBatch = contentForBatch.slice(0, Math.floor(contentForBatch.length * 0.7))
        prompt = buildPrompt(contentForBatch)
        promptTokens = estimateTokens(prompt)
      }

      const maxOutputTokens = Math.max(
        512,
        Math.min(MAX_OUTPUT_TOKENS, contextSize - promptTokens - 256)
      )
      Logger.info(
        'QuizService',
        `Batch budget: promptTokens≈${promptTokens}, ctx=${contextSize}, maxOutput=${maxOutputTokens}`
      )

      try {
        // Heartbeat: local models may not stream partial JSON, so advance the
        // progress bar on a timer while the request is in flight.
        const heartbeat = setInterval(() => onPartialProgress?.(), 4000)
        let text = ''
        try {
          const response = await withAbortTimeout(
            (signal) =>
              generateText({
                model,
                prompt,
                temperature: 0.4,
                maxOutputTokens,
                maxRetries: 0,
                abortSignal: signal
              }),
            GENERATION_TIMEOUT_MS
          )
          text = response.text
        } finally {
          clearInterval(heartbeat)
        }

        const parsed = parseQuizPayload(text)
        if (!parsed) {
          throw new Error('Model không trả về JSON hợp lệ')
        }

        const questionsRaw = sanitizeQuizQuestions(parsed, questionCount)
        if (questionsRaw.length === 0) {
          throw new Error('Model không trả về câu hỏi hợp lệ (cần câu hỏi + đúng 4 lựa chọn)')
        }

        const validated = BatchSchema.safeParse({ questions: questionsRaw })
        if (!validated.success) {
          const detail = validated.error.issues[0]?.message || 'invalid structure'
          throw new Error(`JSON không đúng cấu trúc: ${detail}`)
        }

        const questions = validated.data.questions
        if (!questions || questions.length < 1) {
          throw new Error('The number of generated questions is incorrect')
        }

        return questions
      } catch (error) {
        lastError = error as Error
        Logger.warn(
          'QuizService',
          `Quiz batch generation attempt ${attempt} failed: ${lastError.message}`
        )
      }
    }

    throw new Error(
      `Không tạo được câu hỏi: ${lastError?.message || 'model trả về dữ liệu không hợp lệ'}. ` +
        'Hãy thử model khác (ví dụ Qwen) hoặc giảm số câu.'
    )
  }

  /**
   * Split aggregated content by document sections and distribute it as evenly as
   * possible across the requested number of parts
   */
  private splitContentIntoParts(content: string, parts: number): string[] {
    const sections = content.split('\n\n---\n\n').filter((s) => s.trim().length > 0)
    if (sections.length === 0) return [content]

    const targetParts = Math.min(Math.max(parts, 1), sections.length)
    const groups: string[][] = Array.from({ length: targetParts }, () => [])
    sections.forEach((section, i) => {
      groups[i % targetParts].push(section)
    })

    return groups.map((group) => group.join('\n\n---\n\n')).filter((s) => s.trim().length > 0)
  }

  /**
   * Validate and clean question data
   */
  private async validateAndCleanQuiz(
    notebookId: string,
    result: QuizGenerationResult
  ): Promise<QuizGenerationResult> {
    const db = getDatabase()

    // Collect all referenced chunkIds
    const allChunkIds = new Set<string>()
    result.questions.forEach((question) => {
      if (question.metadata?.chunkIds) {
        question.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
      }
    })

    // Verify that the chunkIds exist
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // Filter out invalid chunkIds
      result.questions = result.questions.map((question) => {
        if (question.metadata?.chunkIds) {
          question.metadata.chunkIds = question.metadata.chunkIds.filter((id) =>
            validChunkIds.has(id)
          )
        }
        return question
      })
    }

    // Deduplicate questions (check for duplicate questionText)
    const uniqueQuestions: QuizQuestion[] = []
    const seenTexts = new Set<string>()
    result.questions.forEach((question) => {
      const normalizedText = question.questionText.trim().toLowerCase()
      if (!seenTexts.has(normalizedText)) {
        seenTexts.add(normalizedText)
        uniqueQuestions.push({
          ...question,
          options: question.options.map((opt) => opt.trim()),
          questionText: question.questionText.trim(),
          explanation: (question.explanation ?? '').trim(),
          hints: (question.hints ?? []).map((hint) => hint.trim())
        })
      }
    })

    result.questions = uniqueQuestions
    result.metadata.totalQuestions = uniqueQuestions.length

    return result
  }

  /**
   * Generate a quiz
   */
  async generateQuiz(
    notebookId: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<string> {
    const db = getDatabase()
    const quizId = `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const startTime = Date.now()

    try {
      // 1. Create the record
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) {
        throw new Error('Notebook not found')
      }

      // Get the current language setting
      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'vi-VN'

      // Get the current version number
      const latestVersion = db
        .select({ version: quizzes.version })
        .from(quizzes)
        .where(eq(quizzes.notebookId, notebookId))
        .orderBy(desc(quizzes.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // Generate the title based on the language
      const titleTemplate = language === 'en-US' ? `${notebook.title} Quiz` : `${notebook.title}`

      const newQuiz: NewQuiz = {
        id: quizId,
        notebookId,
        title: titleTemplate,
        version: newVersion,
        questionsData: [],
        chunkMapping: {},
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      db.insert(quizzes).values(newQuiz).run()
      Logger.info('QuizService', `Created quiz: ${quizId}, version: ${newVersion}`)

      // Create the corresponding item (appended to the end of the list)
      const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      const newOrder = maxOrder + 1

      const itemId = `item-quiz-${quizId}`
      db.insert(items)
        .values({
          id: itemId,
          notebookId,
          type: 'quiz',
          resourceId: quizId,
          order: newOrder,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .run()
      Logger.info('QuizService', `Created item for quiz: ${itemId} with order: ${newOrder}`)

      // 2. Aggregate content
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId, options?.documentIds)

      // 3. Call the LLM to generate
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. Validate and clean the data
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanQuiz(notebookId, result)

      // 5. Build chunkMapping
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.questions.forEach((question) => {
        if (question.metadata?.chunkIds && question.metadata.chunkIds.length > 0) {
          chunkMapping[question.id] = question.metadata.chunkIds
        }
      })

      // 6. Update the database
      onProgress?.('saving_quiz', 90)

      const generationTime = Date.now() - startTime

      db.update(quizzes)
        .set({
          questionsData: validatedResult.questions,
          chunkMapping,
          metadata: {
            model: (await this.apiClient.getChatProvider())?.getDefaultChatModel() || 'unknown',
            totalQuestions: validatedResult.metadata.totalQuestions,
            generationTime
          },
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(quizzes.id, quizId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)

      Logger.info('QuizService', `Quiz generated successfully: ${quizId}`)
      return quizId
    } catch (error) {
      Logger.error('QuizService', 'Error generating quiz:', error)

      // A failed generation leaves an empty quiz in the notebook list; remove
      // both the item and the quiz row so retries don't accumulate ghosts.
      try {
        db.delete(items).where(eq(items.resourceId, quizId)).run()
        db.delete(quizzes).where(eq(quizzes.id, quizId)).run()
      } catch (cleanupError) {
        Logger.warn('QuizService', 'Failed to clean up quiz after error:', cleanupError)
      }

      throw error
    }
  }

  /**
   * Get the quiz bank
   */
  getQuiz(quizId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()
    return quiz
  }

  /**
   * Get the latest quiz bank for a notebook
   */
  getLatestQuiz(notebookId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.notebookId, notebookId), eq(quizzes.status, 'completed')))
      .orderBy(desc(quizzes.version))
      .limit(1)
      .get()
    return quiz
  }

  /**
   * Submit a quiz session
   */
  submitSession(quizId: string, answers: Record<string, number>): string {
    const db = getDatabase()
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // Get the quiz bank
    const quiz = this.getQuiz(quizId)
    if (!quiz) {
      throw new Error('Quiz bank not found')
    }

    const questions = quiz.questionsData

    // Calculate the score
    let correctCount = 0
    questions.forEach((question) => {
      const userAnswer = answers[question.id]
      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount++
      }
    })

    const totalQuestions = questions.length
    const score = Math.round((correctCount / totalQuestions) * 100)

    // Feedback loop: kết quả quiz trở thành tín hiệu cho retrieval.
    // Câu trả lời đúng → chunk nguồn được boost; sai → giảm trọng số.
    const chunkMapping = quiz.chunkMapping
    if (chunkMapping) {
      const answeredQuestions = questions.filter((q) => answers[q.id] !== undefined)
      const referencedChunkIds = [
        ...new Set(answeredQuestions.flatMap((q) => chunkMapping[q.id] || []))
      ]
      const existingChunkIds = new Set(
        referencedChunkIds.length > 0
          ? db
              .select({ id: chunks.id })
              .from(chunks)
              .where(inArray(chunks.id, referencedChunkIds))
              .all()
              .map((c) => c.id)
          : []
      )

      const feedbackRows: NewChunkFeedback[] = []
      for (const question of answeredQuestions) {
        const kind =
          answers[question.id] === question.correctAnswer ? 'citation_good' : 'citation_bad'
        for (const chunkId of chunkMapping[question.id] || []) {
          if (!existingChunkIds.has(chunkId)) continue
          feedbackRows.push({
            id: `fb_${randomUUID()}`,
            chunkId,
            notebookId: quiz.notebookId,
            kind,
            note: `quiz:${quizId}:${question.id}`,
            createdAt: new Date()
          })
        }
      }

      if (feedbackRows.length > 0) {
        db.insert(chunkFeedback).values(feedbackRows).run()
        Logger.info('QuizService', `Quiz feedback recorded on ${feedbackRows.length} chunks`)
      }
    }

    // Create the session record
    const newSession: NewQuizSession = {
      id: sessionId,
      quizId,
      notebookId: quiz.notebookId,
      answers,
      score,
      totalQuestions,
      correctCount,
      completedAt: new Date(),
      createdAt: new Date()
    }

    db.insert(quizSessions).values(newSession).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz session created: ${sessionId}, score: ${score}`)

    return sessionId
  }

  /**
   * Get a quiz session
   */
  getSession(sessionId: string): QuizSession | undefined {
    const db = getDatabase()
    const session = db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)).get()
    return session
  }

  /**
   * Get the source chunks for a question (from chunkMapping) — used to display
   * "which document section this question is based on".
   */
  getQuestionChunks(
    quizId: string,
    questionId: string
  ): Array<{ id: string; content: string; documentTitle: string }> {
    const db = getDatabase()
    const quiz = this.getQuiz(quizId)
    if (!quiz) return []

    const chunkMapping = quiz.chunkMapping
    const chunkIds = chunkMapping?.[questionId] || []
    if (chunkIds.length === 0) return []

    const chunkRows = db.select().from(chunks).where(inArray(chunks.id, chunkIds)).all()
    const docIds = [...new Set(chunkRows.map((c) => c.documentId))]
    const docRows = db.select().from(documents).where(inArray(documents.id, docIds)).all()
    const docMap = new Map(docRows.map((d) => [d.id, d.title]))

    return chunkRows.map((c) => ({
      id: c.id,
      content: c.content,
      documentTitle: docMap.get(c.documentId) || 'Unknown'
    }))
  }

  /**
   * Update the quiz bank
   */
  updateQuiz(quizId: string, updates: Partial<{ title: string }>): void {
    const db = getDatabase()
    db.update(quizzes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(quizzes.id, quizId))
      .run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz updated: ${quizId}`)
  }

  /**
   * Delete the quiz bank
   */
  deleteQuiz(quizId: string): void {
    const db = getDatabase()

    // Delete the associated item first
    db.delete(items)
      .where(and(eq(items.type, 'quiz'), eq(items.resourceId, quizId)))
      .run()
    Logger.info('QuizService', `Deleted item for quiz: ${quizId}`)

    // Delete the quiz bank itself (cascades to quizSessions)
    db.delete(quizzes).where(eq(quizzes.id, quizId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz deleted: ${quizId}`)
  }
}
