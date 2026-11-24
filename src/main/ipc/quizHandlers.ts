/**
 * Quiz IPC Handlers
 * IPC handlers for the quiz feature
 */

import { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { QuizGenerationOptions, QuizService } from '../services/QuizService'
import { createQuizWindow } from '../windows/quizWindow'
import { registerStreamingHandler, registerValidatedHandler } from './handlerRegistry'

const QuizSchemas = {
  generate: z.object({
    notebookId: z.string().min(1),
    options: z
      .object({
        documentIds: z.array(z.string().min(1)).max(50).optional(),
        questionCount: z.number().int().min(1).max(50).optional()
      })
      .passthrough()
      .optional()
  }),
  getLatest: z.object({ notebookId: z.string().min(1) }),
  get: z.object({ quizId: z.string().min(1) }),
  submitSession: z.object({
    quizId: z.string().min(1),
    answers: z.record(z.string(), z.number().int())
  }),
  getSession: z.object({ sessionId: z.string().min(1) }),
  getQuestionChunks: z.object({
    quizId: z.string().min(1),
    questionId: z.string().min(1)
  }),
  update: z.object({
    quizId: z.string().min(1),
    updates: z.object({ title: z.string().min(1).max(200).optional() })
  }),
  delete: z.object({ quizId: z.string().min(1) }),
  openWindow: z.object({
    notebookId: z.string().min(1),
    quizId: z.string().min(1).optional()
  })
}

/**
 * Registers the quiz-related IPC handlers
 */
export function registerQuizHandlers(quizService: QuizService): void {
  registerStreamingHandler('quiz:generate', QuizSchemas.generate, async (event, args) => {
    let quizId: string | undefined
    try {
      const options = args.options
        ? ({
            ...args.options,
            documentIds: Array.isArray(args.options.documentIds)
              ? args.options.documentIds.filter((id): id is string => typeof id === 'string')
              : undefined
          } as QuizGenerationOptions)
        : undefined

      quizId = await quizService.generateQuiz(args.notebookId, options, (stage, progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('quiz:progress', {
            notebookId: args.notebookId,
            stage,
            progress
          })
        }
      })
      return { success: true, quizId }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    } finally {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('quiz:generated', { notebookId: args.notebookId, quizId })
        }
      }
    }
  })

  registerValidatedHandler('quiz:get-latest', QuizSchemas.getLatest, async (args) => {
    try {
      return quizService.getLatestQuiz(args.notebookId) || null
    } catch (error) {
      console.error('Error getting latest quiz:', error)
      return null
    }
  })

  registerValidatedHandler('quiz:get', QuizSchemas.get, async (args) => {
    try {
      return quizService.getQuiz(args.quizId) || null
    } catch (error) {
      console.error('Error getting quiz:', error)
      return null
    }
  })

  registerValidatedHandler('quiz:submit-session', QuizSchemas.submitSession, async (args) => {
    try {
      const sessionId = quizService.submitSession(args.quizId, args.answers)
      return { success: true, sessionId }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  registerValidatedHandler('quiz:get-session', QuizSchemas.getSession, async (args) => {
    try {
      return quizService.getSession(args.sessionId) || null
    } catch (error) {
      console.error('Error getting quiz session:', error)
      return null
    }
  })

  registerValidatedHandler(
    'quiz:get-question-chunks',
    QuizSchemas.getQuestionChunks,
    async (args) => {
      try {
        return quizService.getQuestionChunks(args.quizId, args.questionId)
      } catch (error) {
        console.error('Error getting question chunks:', error)
        return []
      }
    }
  )

  registerValidatedHandler('quiz:update', QuizSchemas.update, async (args) => {
    try {
      quizService.updateQuiz(args.quizId, args.updates)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  registerValidatedHandler('quiz:delete', QuizSchemas.delete, async (args) => {
    try {
      quizService.deleteQuiz(args.quizId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  registerValidatedHandler('quiz:open-window', QuizSchemas.openWindow, async (args) => {
    try {
      createQuizWindow(args.notebookId, args.quizId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
