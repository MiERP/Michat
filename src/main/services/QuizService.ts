/**
 * QuizService
 * 答题服务 - 生成和管理笔记本的答题题库
 */

import { getDatabase, executeCheckpoint } from '../db'
import { quizzes, documents, chunks, notebooks, items, quizSessions } from '../db/schema'
import type { Quiz, NewQuiz, QuizSession, NewQuizSession } from '../db/schema'
import type { QuizQuestion, QuizGenerationResult } from '../../shared/types/quiz'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ProviderManager } from '../providers/ProviderManager'
import { AISDKProvider } from '../providers/base/AISDKProvider'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

/**
 * 进度回调函数类型
 */
export type QuizProgressCallback = (stage: string, progress: number) => void

const MAX_SOURCE_DOCS = 10
const MAX_CHUNKS_PER_DOC = 4
const MAX_CHARS_PER_CHUNK = 900
const MAX_PROMPT_CONTENT_CHARS = 32000

type QualityMode = 'fast' | 'balanced' | 'accurate'

function getQualityMode(): QualityMode {
  const mode = (process.env.KN_GEN_QUALITY || 'balanced').toLowerCase()
  if (mode === 'fast' || mode === 'accurate') return mode
  return 'balanced'
}

/**
 * 答题生成选项
 */
export interface QuizGenerationOptions {
  questionCount?: number // 题目数量，默认10
  difficulty?: 'easy' | 'medium' | 'hard' // 难度，默认medium
  customPrompt?: string // 自定义提示词
}

/**
 * 获取quiz生成 Prompt（支持国际化和自定义）
 */
async function getQuizPrompt(customPrompt?: string): Promise<string> {
  // 如果提供了自定义提示词，直接使用
  if (customPrompt && customPrompt.trim()) {
    return customPrompt.trim()
  }

  // 否则从设置中获取
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'vi-VN'

  const prompt = settings.prompts?.quiz?.[language]

  if (!prompt) {
    throw new Error(`未找到 ${language} 语言的答题生成提示词`)
  }

  return prompt
}

/**
 * 获取难度指令文本
 */
function getDifficultyInstruction(
  difficulty: 'easy' | 'medium' | 'hard',
  language: string
): string {
  const difficultyInstructions = {
    easy: {
      'vi-VN':
        '难度要求：简单 - 请生成简单难度的题目，重点考察基础概念和定义，选项之间的差异要明显。',
      'en-US':
        'Difficulty: Easy - Generate easy-difficulty questions that focus on basic concepts and definitions. Options should have clear differences.'
    },
    medium: {
      'vi-VN':
        '难度要求：中等 - 请生成中等难度的题目，需要理解和应用知识点，适当增加选项的相似性。',
      'en-US':
        'Difficulty: Medium - Generate medium-difficulty questions that require understanding and applying knowledge points, with moderately similar options.'
    },
    hard: {
      'vi-VN':
        '难度要求：困难 - 请生成困难题目，需要深度理解、综合应用和分析能力，选项之间要有一定的迷惑性。',
      'en-US':
        'Difficulty: Hard - Generate hard-difficulty questions that require deep understanding, comprehensive application, and analytical ability. Options should be somewhat confusing.'
    }
  }

  return difficultyInstructions[difficulty][language] || difficultyInstructions[difficulty]['vi-VN']
}

/**
 * Zod Schema 定义答题结构
 */
const QuizQuestionSchema: z.ZodType<QuizQuestion> = z.object({
  id: z.string().describe('题目唯一ID'),
  questionText: z.string().max(200).describe('题目文本，不超过200字'),
  options: z.array(z.string().max(100)).length(4).describe('4个选项'),
  correctAnswer: z.number().min(0).max(3).describe('正确答案索引（0-3）'),
  explanation: z.string().max(300).describe('答案解释，不超过300字'),
  hints: z.array(z.string().max(100)).min(1).max(2).describe('1-2个提示'),
  metadata: z
    .object({
      chunkIds: z.array(z.string()).describe('关联的chunk ID列表')
    })
    .optional()
})

/**
 * 创建动态Quiz Schema
 */
function createQuizSchema(questionCount: number) {
  return z.object({
    questions: z.array(QuizQuestionSchema).length(questionCount).describe(`${questionCount}道题目`),
    metadata: z.object({
      totalQuestions: z.number().describe('总题数')
    })
  })
}

/**
 * 答题服务
 */
export class QuizService {
  constructor(private providerManager: ProviderManager) {}

  /**
   * 聚合笔记本内容
   */
  private trimChunkContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_CHUNK)
  }

  private async aggregateNotebookContent(notebookId: string): Promise<string> {
    const db = getDatabase()
    const contentParts: string[] = []
    const mode = getQualityMode()
    const docsLimit = mode === 'fast' ? 6 : mode === 'accurate' ? 12 : MAX_SOURCE_DOCS
    const chunksPerDoc = mode === 'fast' ? 3 : mode === 'accurate' ? 6 : MAX_CHUNKS_PER_DOC

    try {
      const docs = db
        .select({
          id: documents.id,
          title: documents.title,
          type: documents.type,
          updatedAt: documents.updatedAt
        })
        .from(documents)
        .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
        .orderBy(desc(documents.updatedAt))
        .limit(docsLimit)
        .all()

      Logger.info('QuizService', `Found ${docs.length} indexed documents (limited)`)

      if (docs.length === 0) {
        throw new Error('笔记本没有可用内容生成题目，请先添加文档到知识库')
      }

      for (const doc of docs) {
        const docChunks = db
          .select({ id: chunks.id, content: chunks.content })
          .from(chunks)
          .where(eq(chunks.documentId, doc.id))
          .orderBy(chunks.chunkIndex)
          .limit(chunksPerDoc)
          .all()

        if (docChunks.length > 0) {
          const chunkContent = docChunks
            .map((c) => `[chunk:${c.id}] ${this.trimChunkContent(c.content)}`)
            .join('\n')
          contentParts.push(`[文档: ${doc.title}]\n${chunkContent}`)
        }
      }

      if (contentParts.length === 0) {
        throw new Error('笔记本没有可用内容生成题目')
      }

      let mergedContent = contentParts.join('\n\n---\n\n')
      if (mergedContent.length > MAX_PROMPT_CONTENT_CHARS) {
        mergedContent = mergedContent.slice(0, MAX_PROMPT_CONTENT_CHARS)
      }

      return mergedContent
    } catch (error) {
      Logger.error('QuizService', 'Error aggregating content:', error)
      throw error
    }
  }

  /**
   * 调用LLM生成题目 (使用 streamObject 结构化输出)
   */
  private async callLLMForGeneration(
    content: string,
    options?: QuizGenerationOptions,
    onProgress?: QuizProgressCallback
  ): Promise<QuizGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) {
      throw new Error('没有可用的对话模型,请先配置LLM提供商')
    }

    if (!(provider instanceof AISDKProvider)) {
      throw new Error('当前 provider 不支持结构化输出')
    }

    Logger.info('QuizService', `Using provider: ${provider.name}`)

    const promptTemplate = await getQuizPrompt(options?.customPrompt)
    const questionCount = Math.min(Math.max(options?.questionCount || 10, 3), 20)
    const difficulty = options?.difficulty || 'medium'

    const isVietNam = promptTemplate.includes('中文') || promptTemplate.includes('题目')
    const language = isVietNam ? 'vi-VN' : 'en-US'
    const difficultyInstruction = getDifficultyInstruction(difficulty, language)

    const model = provider.getAIModel()
    const QuizSchema = createQuizSchema(questionCount)

    let lastError: Error | null = null
    const mode = getQualityMode()
    const maxAttempts = mode === 'accurate' ? 3 : mode === 'fast' ? 1 : 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const correction =
        attempt === 1
          ? ''
          : '\n\n【修正要求】必须严格输出 JSON；题目数量严格等于要求值；每题4个选项且只有1个正确答案；不要重复题干。若不确定，优先题目质量。'

      let prompt = promptTemplate.replace(/\{\{QUESTION_COUNT\}\}/g, questionCount.toString())
      prompt = prompt.replace(/\{\{DIFFICULTY_INSTRUCTION\}\}/g, difficultyInstruction)
      prompt = prompt.replace(/\{\{CONTENT\}\}/g, content)
      prompt = `${prompt}${correction}`

      try {
        onProgress?.('generating_quiz', attempt === 1 ? 30 : 45)

        const { partialObjectStream, object } = streamObject({
          model,
          schema: QuizSchema,
          prompt
        })

        let lastProgress = attempt === 1 ? 30 : 45
        let chunkCount = 0
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of partialObjectStream) {
          chunkCount++
          if (chunkCount % 6 === 0) {
            lastProgress = Math.min(lastProgress + 4, 68)
            onProgress?.('generating_quiz', lastProgress)
          }
        }

        onProgress?.('parsing_result', 70)

        const result = await object
        if (!result.questions || result.questions.length < 1) {
          throw new Error('生成的题目数量不正确')
        }

        return {
          questions: result.questions,
          metadata: result.metadata
        }
      } catch (error) {
        lastError = error as Error
        Logger.warn(
          'QuizService',
          `Quiz generation attempt ${attempt} failed: ${lastError.message}`
        )
      }
    }

    throw new Error(`生成题目失败: ${lastError?.message || 'unknown error'}`)
  }

  /**
   * 验证和清洗题目数据
   */
  private async validateAndCleanQuiz(
    notebookId: string,
    result: QuizGenerationResult
  ): Promise<QuizGenerationResult> {
    const db = getDatabase()

    // 收集所有提到的chunkIds
    const allChunkIds = new Set<string>()
    result.questions.forEach((question) => {
      if (question.metadata?.chunkIds) {
        question.metadata.chunkIds.forEach((id) => allChunkIds.add(id))
      }
    })

    // 验证chunkIds是否存在
    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()

      const validChunkIds = new Set(validChunks.map((c) => c.id))

      // 过滤无效的chunkIds
      result.questions = result.questions.map((question) => {
        if (question.metadata?.chunkIds) {
          question.metadata.chunkIds = question.metadata.chunkIds.filter((id) =>
            validChunkIds.has(id)
          )
        }
        return question
      })
    }

    // 题目去重（检查questionText是否重复）
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
          explanation: question.explanation.trim(),
          hints: question.hints.map((hint) => hint.trim())
        })
      }
    })

    result.questions = uniqueQuestions
    result.metadata.totalQuestions = uniqueQuestions.length

    return result
  }

  /**
   * 生成题目
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
      // 1. 创建记录
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) {
        throw new Error('笔记本不存在')
      }

      // 获取当前语言设置
      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'vi-VN'

      // 获取当前版本号
      const latestVersion = db
        .select({ version: quizzes.version })
        .from(quizzes)
        .where(eq(quizzes.notebookId, notebookId))
        .orderBy(desc(quizzes.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1

      // 根据语言生成标题
      const titleTemplate =
        language === 'en-US' ? `${notebook.title} Quiz` : `${notebook.title}`

      const newQuiz: NewQuiz = {
        id: quizId,
        notebookId,
        title: titleTemplate,
        version: newVersion,
        questionsData: [] as any,
        chunkMapping: {} as any,
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      db.insert(quizzes).values(newQuiz).run()
      Logger.info('QuizService', `Created quiz: ${quizId}, version: ${newVersion}`)

      // 创建对应的 item（添加到列表末尾）
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

      // 2. 聚合内容
      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      // 3. 调用LLM生成
      const result = await this.callLLMForGeneration(content, options, onProgress)

      // 4. 验证和清洗数据
      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanQuiz(notebookId, result)

      // 5. 构建chunkMapping
      const chunkMapping: Record<string, string[]> = {}
      validatedResult.questions.forEach((question) => {
        if (question.metadata?.chunkIds && question.metadata.chunkIds.length > 0) {
          chunkMapping[question.id] = question.metadata.chunkIds
        }
      })

      // 6. 更新数据库
      onProgress?.('saving_quiz', 90)

      const generationTime = Date.now() - startTime

      db.update(quizzes)
        .set({
          questionsData: validatedResult.questions as any,
          chunkMapping: chunkMapping as any,
          metadata: {
            model: (await this.providerManager.getActiveChatProvider())?.name || 'unknown',
            totalQuestions: validatedResult.metadata.totalQuestions,
            generationTime
          } as any,
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

      // 更新状态为失败
      db.update(quizzes)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(quizzes.id, quizId))
        .run()

      throw error
    }
  }

  /**
   * 获取题库
   */
  getQuiz(quizId: string): Quiz | undefined {
    const db = getDatabase()
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()
    return quiz
  }

  /**
   * 获取笔记本最新版本题库
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
   * 提交答题会话
   */
  submitSession(quizId: string, answers: Record<string, number>): string {
    const db = getDatabase()
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    // 获取题库
    const quiz = this.getQuiz(quizId)
    if (!quiz) {
      throw new Error('题库不存在')
    }

    const questions = quiz.questionsData as any as QuizQuestion[]

    // 计算分数
    let correctCount = 0
    questions.forEach((question) => {
      const userAnswer = answers[question.id]
      if (userAnswer !== undefined && userAnswer === question.correctAnswer) {
        correctCount++
      }
    })

    const totalQuestions = questions.length
    const score = Math.round((correctCount / totalQuestions) * 100)

    // 创建会话记录
    const newSession: NewQuizSession = {
      id: sessionId,
      quizId,
      notebookId: quiz.notebookId,
      answers: answers as any,
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
   * 获取答题会话
   */
  getSession(sessionId: string): QuizSession | undefined {
    const db = getDatabase()
    const session = db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)).get()
    return session
  }

  /**
   * 更新题库
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
   * 删除题库
   */
  deleteQuiz(quizId: string): void {
    const db = getDatabase()

    // 先删除关联的 item
    db.delete(items)
      .where(and(eq(items.type, 'quiz'), eq(items.resourceId, quizId)))
      .run()
    Logger.info('QuizService', `Deleted item for quiz: ${quizId}`)

    // 删除题库本身（会级联删除quizSessions）
    db.delete(quizzes).where(eq(quizzes.id, quizId)).run()
    executeCheckpoint('PASSIVE')
    Logger.info('QuizService', `Quiz deleted: ${quizId}`)
  }
}
