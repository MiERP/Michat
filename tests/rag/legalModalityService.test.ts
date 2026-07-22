import { describe, expect, it } from 'vitest'
import { findLegalModalityHints } from '../../src/main/services/legalGraph/LegalModalityService'

describe('LegalModalityService', () => {
  it('tags all three modalities with absolute offsets', () => {
    const text =
      'Doanh nghi\u1ec7p ph\u1ea3i b\u00e1o c\u00e1o. C\u01a1 quan c\u00f3 quy\u1ec1n ki\u1ec3m tra. Kh\u00f4ng \u0111\u01b0\u1ee3c ti\u1ebft l\u1ed9 d\u1eef li\u1ec7u.'

    expect(findLegalModalityHints(text, 100)).toEqual([
      {
        type: 'obligation',
        confidence: 0.55,
        evidenceText: 'ph\u1ea3i',
        startOffset: 113,
        endOffset: 117
      },
      {
        type: 'permission',
        confidence: 0.55,
        evidenceText: 'c\u00f3 quy\u1ec1n',
        startOffset: 135,
        endOffset: 143
      },
      {
        type: 'prohibition',
        confidence: 0.55,
        evidenceText: 'Kh\u00f4ng \u0111\u01b0\u1ee3c',
        startOffset: 154,
        endOffset: 164
      }
    ])
  })

  it('recognizes closed lexical variants case-insensitively', () => {
    const text =
      'NGHI\u00caM C\u1ea4M sao ch\u00e9p. Ch\u1ee7 th\u1ec3 c\u00f3 tr\u00e1ch nhi\u1ec7m b\u1ea3o v\u1ec7 v\u00e0 \u0111\u01b0\u1ee3c ph\u00e9p khi lu\u1eadt cho ph\u00e9p.'

    expect(
      findLegalModalityHints(text, 0).map(({ type, evidenceText }) => ({ type, evidenceText }))
    ).toEqual([
      { type: 'prohibition', evidenceText: 'NGHI\u00caM C\u1ea4M' },
      { type: 'obligation', evidenceText: 'c\u00f3 tr\u00e1ch nhi\u1ec7m' },
      { type: 'permission', evidenceText: '\u0111\u01b0\u1ee3c ph\u00e9p' }
    ])
  })

  it('does not treat passive bare \u0111\u01b0\u1ee3c as permission', () => {
    expect(
      findLegalModalityHints(
        'H\u1ed3 s\u01a1 \u0111\u01b0\u1ee3c l\u01b0u t\u1ea1i c\u01a1 quan.',
        0
      )
    ).toEqual([])
  })
})
