import { readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

interface EvalCase {
  id: string
  query: string
  expectedTerms: string[]
}

interface FormatEvalSuite {
  format: string
  content: string
  cases: EvalCase[]
}

function retrieveByLexicalOverlap(content: string, query: string, topK: number): string[] {
  const chunks = content
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
  const queryTokens = new Set(query.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean))

  return chunks
    .map((chunk) => {
      const tokens = chunk.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean)
      const score = tokens.reduce((hits, token) => hits + (queryTokens.has(token) ? 1 : 0), 0)
      return { chunk, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.chunk)
}

describe('deterministic RAG eval fixtures', () => {
  it('retrieves expected local-first citation chunks in top 3', async () => {
    const markdownFixture = await readFile(join(process.cwd(), 'tests/fixtures/rag/local-first.md'), 'utf8')
    const suites: FormatEvalSuite[] = [
      {
        format: 'markdown',
        content: markdownFixture,
        cases: [
          {
            id: 'local-first-policy',
            query: 'local-first t?i li?u embeddings truy v?n c? r?i kh?i m?y kh?ng',
            expectedTerms: ['embeddings', 'provider remote']
          },
          {
            id: 'privacy-table',
            query: 'b?ng quy?n ri?ng t? query rag m?c ??nh l? g?',
            expectedTerms: ['Query RAG', 'Local']
          }
        ]
      },
      {
        format: 'txt',
        content:
          'T?i li?u TXT d?i m? t? production RAG local-first.\n\nCitation ph?i ch? v? chunk ngu?n, documentId v? title.\n\nRemote provider kh?ng ???c g?i n?u ng??i d?ng ch?a opt-in.',
        cases: [
          {
            id: 'txt-citation',
            query: 'citation trong t?i li?u txt c?n ch? v? ??u',
            expectedTerms: ['chunk', 'documentId', 'title']
          }
        ]
      },
      {
        format: 'pdf',
        content:
          'Trang PDF 1 n?i v? ch?nh s?ch b?o m?t.\n\nTrang PDF 2 ghi r?ng query RAG v? embedding ch?y local tr?n m?y ng??i d?ng.',
        cases: [
          {
            id: 'pdf-page-evidence',
            query: 'pdf query rag embedding ch?y ? ??u',
            expectedTerms: ['PDF 2', 'local']
          }
        ]
      },
      {
        format: 'docx',
        content:
          'Heading: Quy tr?nh nh?p DOCX.\n\nDOCX h?p l? ph?i t?o chunks, embeddings v? status indexed.\n\nKhi l?i parse, document ph?i failed v?i errorMessage r? r?ng.',
        cases: [
          {
            id: 'docx-lifecycle',
            query: 'docx h?p l? t?o tr?ng th?i v? embedding nh? th? n?o',
            expectedTerms: ['chunks', 'embeddings', 'indexed']
          }
        ]
      },
      {
        format: 'pptx',
        content:
          'Slide 1: Local-first default.\n\nSlide 2: Kh?ng silent fallback sang remote provider.\n\nSlide 3: Ng??i d?ng ph?i b?t opt-in tr??c khi d? li?u r?i m?y.',
        cases: [
          {
            id: 'pptx-no-remote-fallback',
            query: 'pptx c? ???c fallback remote provider kh?ng',
            expectedTerms: ['silent fallback', 'remote provider']
          }
        ]
      },
      {
        format: 'xlsx',
        content:
          '[[TABLE_START:sheet=Evidence;rows=3;cols=3]]\nheader: Topic | Default | Evidence\nrow 1: Query RAG | Local | Truy v?n v? citation kh?ng r?i kh?i m?y\nrow 2: Embedding | Local | Vector ???c t?o b?ng provider local\n[[TABLE_END]]',
        cases: [
          {
            id: 'xlsx-table-evidence',
            query: 'xlsx query rag default local citation evidence',
            expectedTerms: ['Query RAG', 'Local', 'citation']
          }
        ]
      }
    ]

    for (const suite of suites) {
      for (const evalCase of suite.cases) {
        const topChunks = retrieveByLexicalOverlap(suite.content, evalCase.query, 3).join('\n')
        for (const expectedTerm of evalCase.expectedTerms) {
          expect(topChunks, `${suite.format}:${evalCase.id}`).toContain(expectedTerm)
        }
      }
    }
  })
})
