import { describe, expect, it } from 'vitest'
import { finalizeChatEvidence } from '../../src/main/services/chatEvidence'
import type { ChatCitation } from '../../src/shared/types/chat'

const citations: ChatCitation[] = [
  {
    index: 1,
    documentId: 'doc-1',
    documentTitle: 'Luật thử nghiệm',
    chunkId: 'chunk-1',
    chunkIndex: 1,
    score: 0.9,
    snippet: 'Điều 1. Nội dung căn cứ.'
  }
]

describe('finalizeChatEvidence', () => {
  it('adds an application-owned citation when model omits markers', () => {
    const result = finalizeChatEvidence('Kết luận dựa trên căn cứ.', citations, {
      requireCitation: true
    })
    expect(result.content).toBe('Kết luận dựa trên căn cứ. [1]')
    expect(result.citations).toEqual(citations)
  })

  it('removes unsupported citation markers', () => {
    expect(finalizeChatEvidence('Kết luận [99].', citations).content).toBe('Kết luận.')
  })

  it('fails closed when evidence-backed output has no substantive claim', () => {
    const result = finalizeChatEvidence('<evidence></evidence>', citations, {
      requireCitation: true
    })
    expect(result.content).toContain('Chưa đủ căn cứ')
    expect(result.citations).toEqual([])
  })

  it('does not attach evidence to an explicit insufficiency refusal', () => {
    const result = finalizeChatEvidence(
      'Chưa đủ căn cứ trong tài liệu đã nhập để trả lời câu hỏi này.',
      citations,
      { requireCitation: true }
    )
    expect(result.citations).toEqual([])
    expect(result.content).not.toContain('[1]')
  })

  it('adds citations to uncited claims even when another claim already has a marker', () => {
    const second = { ...citations[0], index: 2, documentId: 'doc-2', chunkId: 'chunk-2' }
    const result = finalizeChatEvidence('Luật thứ nhất điều chỉnh an ninh mạng.\nLuật thứ hai sửa đổi sở hữu trí tuệ [1].', [citations[0], second], { requireCitation: true })
    expect(result.content).toContain('an ninh mạng. [2]')
    expect(result.citations).toHaveLength(2)
  })

  it('keeps direct evidence markers without adding one to every line', () => {
    const result = finalizeChatEvidence('Dòng chứng cứ thứ nhất.\nDòng chứng cứ thứ hai. [1]', citations, {
      requireCitation: true,
      addMissingClaimCitations: false
    })
    expect(result.content).toBe('Dòng chứng cứ thứ nhất.\nDòng chứng cứ thứ hai. [1]')
  })
})
