import type { LegalModality, LegalModalityTag } from '../../../shared/types/legalReasoning'

const LEGAL_MODALITY_CONFIDENCE = 0.55
const TOKEN_START = '(?<![\\p{L}\\p{N}_])'
const TOKEN_END = '(?![\\p{L}\\p{N}_])'

const PATTERNS: ReadonlyArray<{ type: LegalModality; pattern: RegExp }> = [
  {
    type: 'prohibition',
    pattern: new RegExp(
      `${TOKEN_START}(kh\u00f4ng\\s+\u0111\u01b0\u1ee3c|nghi\u00eam\\s+c\u1ea5m|c\u1ea5m)${TOKEN_END}`,
      'giu'
    )
  },
  {
    type: 'obligation',
    pattern: new RegExp(
      `${TOKEN_START}(ph\u1ea3i|c\u00f3\\s+tr\u00e1ch\\s+nhi\u1ec7m|c\u00f3\\s+ngh\u0129a\\s+v\u1ee5|b\u1eaft\\s+bu\u1ed9c)${TOKEN_END}`,
      'giu'
    )
  },
  {
    type: 'permission',
    pattern: new RegExp(
      `${TOKEN_START}(c\u00f3\\s+quy\u1ec1n|\u0111\u01b0\u1ee3c\\s+ph\u00e9p|\u0111\u01b0\u1ee3c\\s+quy\u1ec1n)${TOKEN_END}`,
      'giu'
    )
  }
]

export function findLegalModalityHints(content: string, baseOffset: number): LegalModalityTag[] {
  const tags: LegalModalityTag[] = []

  for (const { type, pattern } of PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const startOffset = baseOffset + match.index
      tags.push({
        type,
        confidence: LEGAL_MODALITY_CONFIDENCE,
        evidenceText: match[0],
        startOffset,
        endOffset: startOffset + match[0].length
      })
    }
  }

  return tags.sort((left, right) => left.startOffset - right.startOffset)
}
