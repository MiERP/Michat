import { describe, expect, it } from 'vitest'
import { ensureInlineCitationPlacement } from '../../src/renderer/src/components/notebook/chat/citationFormatting'
import type { ChatCitation } from '../../src/shared/types/chat'

const citations: ChatCitation[] = [
  {
    index: 1,
    documentId: 'doc-1',
    documentTitle: 'Nguồn chính',
    chunkId: 'chunk-1',
    chunkIndex: 0,
    score: 0.9,
    snippet: 'Bằng chứng chính'
  }
]

describe('ensureInlineCitationPlacement', () => {
  it('adds the highest-ranked retrieved citation when the model omits every citation marker', () => {
    expect(ensureInlineCitationPlacement('Câu trả lời dựa trên tài liệu.', citations)).toBe(
      'Câu trả lời dựa trên tài liệu. [1]'
    )
  })

  it('keeps a valid citation emitted by the model unchanged', () => {
    expect(ensureInlineCitationPlacement('Câu trả lời có nguồn [1].', citations)).toBe(
      'Câu trả lời có nguồn [1].'
    )
  })

  it('normalizes a parenthesized model citation into one clickable [n] marker', () => {
    expect(ensureInlineCitationPlacement('Kết luận từ tài liệu. (1)', citations)).toBe(
      'Kết luận từ tài liệu. [1]'
    )
  })

  it('collapses adjacent duplicate markers emitted by the model', () => {
    expect(ensureInlineCitationPlacement('Kết luận từ tài liệu. (1) [1]', citations)).toBe(
      'Kết luận từ tài liệu. [1]'
    )
  })
})
