import { describe, expect, it } from 'vitest'
import {
  NOTEBOOK_OVERVIEW_PROMPT_LIMITS,
  buildNotebookOverviewSource,
  limitPromptContent,
  selectRepresentativeChunks
} from '../../src/main/services/notebookOverviewPrompt'

describe('notebook overview source selection', () => {
  it('keeps the full notebook source inside one fixed prompt budget', () => {
    expect(NOTEBOOK_OVERVIEW_PROMPT_LIMITS).toEqual({
      overviewInputChars: 6000
    })
  })

  it('shares source budget across every document', () => {
    const source = buildNotebookOverviewSource(
      [
        {
          index: 1,
          title: 'First.pdf',
          chunks: [{ chunkIndex: 0, content: 'FIRST ' + 'a'.repeat(1000) }]
        },
        {
          index: 2,
          title: 'Middle.pdf',
          chunks: [{ chunkIndex: 0, content: 'MIDDLE ' + 'b'.repeat(1000) }]
        },
        {
          index: 3,
          title: 'Last.pdf',
          chunks: [{ chunkIndex: 0, content: 'LAST ' + 'c'.repeat(1000) }]
        }
      ],
      900
    )

    expect(source.length).toBeLessThanOrEqual(900)
    expect(source).toContain('Tài liệu 1: First.pdf')
    expect(source).toContain('Tài liệu 2: Middle.pdf')
    expect(source).toContain('Tài liệu 3: Last.pdf')
    expect(source).toContain('FIRST')
    expect(source).toContain('MIDDLE')
    expect(source).toContain('LAST')
  })

  it('selects positional coverage and high-signal legal chunks locally', () => {
    const chunks = Array.from({ length: 10 }, (_, chunkIndex) => ({
      chunkIndex,
      content:
        chunkIndex === 2
          ? 'Sửa đổi nghĩa vụ, trách nhiệm, quyền và mức phạt áp dụng.'
          : 'Nội dung thông thường phần ' + chunkIndex + '.'
    }))

    const selected = selectRepresentativeChunks(chunks, 900).map((chunk) => chunk.chunkIndex)

    expect(selected).toContain(0)
    expect(selected).toContain(5)
    expect(selected).toContain(9)
    expect(selected).toContain(2)
  })

  it('keeps both beginning and end when one chunk exceeds its budget', () => {
    const content = 'BEGIN ' + 'x'.repeat(100) + ' END'
    const limited = limitPromptContent(content, 40)

    expect(limited.length).toBeLessThanOrEqual(40)
    expect(limited).toContain('BEGIN')
    expect(limited).toContain('END')
    expect(limited).toContain('[...truncated...]')
  })
})
