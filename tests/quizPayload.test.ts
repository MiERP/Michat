import { describe, expect, it } from 'vitest'
import { parseQuizPayload, sanitizeQuizQuestions } from '../src/main/services/quizPayload'

describe('parseQuizPayload', () => {
  it('extracts a JSON object wrapped in prose and markdown fences', () => {
    const raw = [
      'Dưới đây là bộ câu hỏi:',
      '```json',
      '{"questions":[{"id":"q1","questionText":"A?","options":["a","b","c","d"],"correctAnswer":0}],"metadata":{"totalQuestions":1}}',
      '```',
      'Chúc bạn học tốt.'
    ].join('\n')

    const parsed = parseQuizPayload(raw) as { questions: unknown[] }
    expect(parsed.questions).toHaveLength(1)
  })

  it('accepts a bare questions array', () => {
    const raw = '[{"id":"q1","questionText":"A?","options":["a","b","c","d"],"correctAnswer":0}]'
    const parsed = parseQuizPayload(raw) as { questions: unknown[] }
    expect(parsed.questions).toHaveLength(1)
  })

  it('repairs trailing commas', () => {
    const raw = '{"questions":[{"id":"q1","questionText":"A?","options":["a","b","c","d"],"correctAnswer":0},],}'
    const parsed = parseQuizPayload(raw) as { questions: unknown[] }
    expect(parsed.questions).toHaveLength(1)
  })

  it('returns null for a response without JSON', () => {
    expect(parseQuizPayload('Tôi không thể tạo câu hỏi lúc này.')).toBeNull()
  })
})

describe('sanitizeQuizQuestions', () => {
  it('coerces long fields and letter answers instead of rejecting them', () => {
    const [question] = sanitizeQuizQuestions(
      {
        questions: [
          {
            id: 'q1',
            questionText: 'x'.repeat(420),
            options: ['a', 'b', 'c', 'd'],
            correctAnswer: 'B',
            explanation: 'y'.repeat(620),
            hints: ['h1', 'h2', 'h3']
          }
        ]
      },
      5
    )

    expect(question.questionText).toHaveLength(420)
    expect(question.correctAnswer).toBe(1)
    expect(question.explanation).toHaveLength(500)
    expect(question.hints).toHaveLength(2)
  })

  it('slices extra questions and skips malformed options', () => {
    const questions = sanitizeQuizQuestions(
      {
        questions: [
          { questionText: 'ok 1', options: ['a', 'b', 'c', 'd'], correctAnswer: 0 },
          { questionText: 'bad', options: ['a', 'b'], correctAnswer: 0 },
          { questionText: 'ok 2', options: ['a', 'b', 'c', 'd'], correctAnswer: 2 }
        ]
      },
      1
    )

    expect(questions).toHaveLength(1)
    expect(questions[0].questionText).toBe('ok 1')
  })
})
