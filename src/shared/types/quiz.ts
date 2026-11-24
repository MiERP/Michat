/**
 * Quiz-related type definitions
 * Shared types for the quiz feature
 */

/**
 * Question
 */
export interface QuizQuestion {
  id: string
  questionText: string
  options: string[] // Fixed 4 options
  correctAnswer: number // 0-3
  explanation: string
  hints: string[] // 1-2 hints
  metadata?: {
    chunkIds: string[]
  }
}

/**
 * Quiz
 */
export interface Quiz {
  id: string
  notebookId: string
  title: string
  version: number
  questions: QuizQuestion[]
  chunkMapping: Record<string, string[]>
  metadata: {
    model: string
    totalQuestions: number
    generationTime: number
  }
  status: 'generating' | 'completed' | 'failed'
  errorMessage?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Quiz session
 */
export interface QuizSession {
  id: string
  quizId: string
  notebookId: string
  answers: Record<string, number> // questionId -> selectedAnswerIndex
  score?: number
  totalQuestions: number
  correctCount?: number
  completedAt?: Date
  createdAt: Date
}

/**
 * Quiz generation result (returned by LLM streamObject)
 */
export interface QuizGenerationResult {
  questions: QuizQuestion[]
  metadata: {
    totalQuestions: number
  }
}
