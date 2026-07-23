import { describe, expect, it } from 'vitest'
import { interleaveEvidenceGroups, isCompleteDirectLookup, matchesExplicitLegalFileMention, matchesLegalDocumentMention, routeLegalAnswer, selectFallbackLegalChunks } from '../../src/main/services/LegalAnswerRouter'

describe('routeLegalAnswer', () => {
  it('returns no_evidence without model work', () => {
    expect(routeLegalAnswer({ query: 'Điều 15 quy định gì?', evidence: [] })).toMatchObject({
      route: 'no_evidence',
      requiresModel: false,
      maxOutputTokens: 0
    })
  })

  it('uses deterministic direct lookup for article, clause, and definition queries', () => {
    for (const query of ['Điều 15 quy định gì?', 'Khoản 2 Điều 7 nói gì?', 'Nghĩa vụ là gì?']) {
      expect(
        routeLegalAnswer({ query, evidence: [{ documentId: 'doc-1' }] })
      ).toMatchObject({ route: 'direct_lookup', requiresModel: false })
    }
  })

  it('uses compact synthesis for one-document evidence', () => {
    expect(
      routeLegalAnswer({
        query: 'Tóm tắt văn bản này',
        evidence: [{ documentId: 'doc-1' }, { documentId: 'doc-1' }]
      })
    ).toMatchObject({ route: 'compact_synthesis', maxOutputTokens: 64, maxHistoryMessages: 2 })
  })

  it('uses deep local reasoning for multi-document comparison', () => {
    expect(
      routeLegalAnswer({
        query: 'So sánh hai văn bản',
        evidence: [{ documentId: 'doc-1' }, { documentId: 'doc-2' }]
      })
    ).toMatchObject({ route: 'deep_reasoning', maxOutputTokens: 128, useGraph: true })
  })

  it('skips graph expansion for narrow scope comparison', () => {
    expect(
      routeLegalAnswer({
        query: 'So sánh phạm vi điều chỉnh của hai luật',
        evidence: [{ documentId: 'doc-1' }, { documentId: 'doc-2' }]
      })
    ).toMatchObject({ route: 'deep_reasoning', useGraph: false })
  })

  it('uses remote only after explicit opt-in', () => {
    const input = {
      query: 'So sánh toàn diện hai văn bản',
      evidence: [{ documentId: 'doc-1' }, { documentId: 'doc-2' }],
      remoteAvailable: true
    }
    expect(routeLegalAnswer(input)).toMatchObject({ route: 'deep_reasoning' })
    expect(routeLegalAnswer({ ...input, allowRemote: true })).toMatchObject({
      route: 'remote_complex'
    })
  })

  it('matches Vietnamese law title mentions without exact document number', () => {
    expect(
      matchesLegalDocumentMention(
        'So sánh Luật An ninh mạng 2018 và Luật số 07/2022/QH15',
        '24_2018_QH14_luật an ninh mạng.pdf',
        '24/2018/QH14'
      )
    ).toBe(true)
  })

  it('preserves physical variants when user names exact files', () => {
    const query = 'So sánh file 07_2022_QH15_458435.docx và 07_2022_QH15_luật sở hữu trí tuệ.pdf'
    expect(matchesExplicitLegalFileMention(query, '07_2022_QH15_458435.docx')).toBe(true)
    expect(matchesExplicitLegalFileMention(query, '07_2022_QH15_luật sở hữu trí tuệ.pdf')).toBe(true)
  })

  it('detects requests for complete article text', () => {
    expect(isCompleteDirectLookup('Trình bày đầy đủ tất cả các khoản của Điều 25A, không bỏ sót.')).toBe(true)
    expect(isCompleteDirectLookup('Điều 25A quy định gì?')).toBe(false)
  })

  it('prefers scope clauses for deterministic document fallback', () => {
    const selected = selectFallbackLegalChunks('So sánh phạm vi điều chỉnh', [
      { chunkIndex: 20, content: 'Điều 20. Quy định khác.' },
      { chunkIndex: 1, content: 'Điều 1. Phạm vi điều chỉnh của Luật này.' }
    ], 1)
    expect(selected[0].chunkIndex).toBe(1)
  })

  it('prefers opening amendment clause when scope heading is absent', () => {
    const selected = selectFallbackLegalChunks('So sánh phạm vi điều chỉnh của Luật Sở hữu trí tuệ', [
      { chunkIndex: 96, content: 'Điều 96. Hủy bỏ hiệu lực văn bằng bảo hộ.' },
      { chunkIndex: 0, content: 'Điều 1. Sửa đổi, bổ sung một số điều của Luật Sở hữu trí tuệ.' }
    ], 1)
    expect(selected[0].chunkIndex).toBe(0)
  })

  it('interleaves evidence so prompt starts with every document', () => {
    expect(interleaveEvidenceGroups([['a1', 'a2'], ['b1', 'b2']])).toEqual(['a1', 'b1', 'a2', 'b2'])
  })
})
