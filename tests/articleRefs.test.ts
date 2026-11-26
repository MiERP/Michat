import { describe, expect, it } from 'vitest'
import {
  extractArticleRefs,
  extractArticleRefsFromContent,
  matchesArticleRef,
  mergeSearchResults,
  prioritizeArticleMatches
} from '../src/main/utils/articleRefs'

describe('articleRefs', () => {
  describe('extractArticleRefs', () => {
    it('extracts unique article numbers from a question', () => {
      expect(extractArticleRefs('Điều 8 khoản 2 và Điều 26, Điều 198b, Điều 8')).toEqual([
        '8',
        '26',
        '198b'
      ])
    })

    it('returns no refs when the question names no numbered article', () => {
      expect(extractArticleRefs('')).toEqual([])
      expect(extractArticleRefs('Điều này quy định gì?')).toEqual([])
      expect(extractArticleRefs('Điều khoản chung của luật')).toEqual([])
    })

    it('normalizes case, repeated whitespace and letter suffixes', () => {
      expect(extractArticleRefs('điều 8, ĐIỀU   18 và Điều 198B')).toEqual(['8', '18', '198b'])
    })

    it('caps the number of requested refs', () => {
      const query = Array.from({ length: 12 }, (_, index) => `Điều ${index + 1}`).join(', ')
      const refs = extractArticleRefs(query)

      expect(refs).toHaveLength(8)
      expect(new Set(refs).size).toBe(8)
      expect(refs[0]).toBe('1')
      expect(refs[7]).toBe('8')
    })
  })

  describe('extractArticleRefsFromContent', () => {
    it('finds an article heading even when chunk metadata points at the parent chapter', () => {
      expect(
        extractArticleRefsFromContent(
          '### Điều 10. Hệ thống thông tin quan trọng về an ninh quốc gia\n\n1. Hệ thống thông tin...'
        )
      ).toEqual(['10'])
      expect(
        extractArticleRefsFromContent('Chương II\n\n## Điều 10. Hệ thống thông tin quan trọng')
      ).toEqual(['10'])
    })

    it('returns headings in source order and respects the cap', () => {
      const content = [
        '### Điều 8. Hành vi bị cấm',
        'Nội dung.',
        '### Điều 9. Trách nhiệm',
        '### Điều 10. Hệ thống thông tin'
      ].join('\n')

      expect(extractArticleRefsFromContent(content)).toEqual(['8', '9'])
      expect(extractArticleRefsFromContent(content, 1)).toEqual(['8'])
    })

    it('ignores article numbers referenced in body text', () => {
      expect(
        extractArticleRefsFromContent(
          [
            'Theo quy định tại Điều 10 của Luật An ninh mạng, chủ quản hệ thống thông tin phải báo cáo.',
            'Khoản 2 Điều 10 quy định trách nhiệm của chủ quản hệ thống.'
          ].join('\n')
        )
      ).toEqual([])
    })

    it('does not treat a heading marker inside a sentence as an article heading', () => {
      expect(extractArticleRefsFromContent('Xem mục ### Điều 10 để biết thêm')).toEqual([])
    })
  })

  describe('matchesArticleRef', () => {
    it('does not treat neighbouring article numbers as the same article', () => {
      expect(matchesArticleRef('Chương II > Điều 8. Hành vi bị cấm', ['8'])).toBe(true)
      expect(matchesArticleRef('Chương II > Điều 18. Phòng chống', ['8'])).toBe(false)
      expect(matchesArticleRef('Điều 198b. Trách nhiệm', ['198b'])).toBe(true)
    })

    it('requires a full article-number boundary', () => {
      expect(matchesArticleRef('Điều 8a. Hành vi', ['8'])).toBe(false)
      expect(matchesArticleRef('Điều 8. Hành vi', ['8a'])).toBe(false)
      expect(matchesArticleRef('điều 8: Hành vi', ['8'])).toBe(true)
      expect(matchesArticleRef('Điều 8 quy định', ['8'])).toBe(true)
    })

    it('returns false when no refs were requested', () => {
      expect(matchesArticleRef('Điều 8. Hành vi', [])).toBe(false)
    })
  })

  describe('prioritizeArticleMatches', () => {
    it('puts explicitly requested articles before higher-scored generic chunks', () => {
      const results = [
        { content: 'generic', score: 0.9, sectionPath: ['Chương I'] },
        { content: 'article', score: 0.2, sectionPath: ['Chương II', 'Điều 8. Hành vi'] }
      ]

      expect(prioritizeArticleMatches(['8'], results).map((item) => item.content)).toEqual([
        'article',
        'generic'
      ])
    })

    it('sorts matched chunks first, each group by score', () => {
      const results = [
        { content: 'generic high', score: 0.9 },
        { content: 'match low', score: 0.3, sectionPath: ['Điều 8. Hành vi'] },
        { content: 'generic low', score: 0.4 },
        { content: 'match high', score: 0.6, sectionPath: ['Điều 8. Hành vi'] }
      ]

      expect(prioritizeArticleMatches(['8'], results).map((item) => item.content)).toEqual([
        'match high',
        'match low',
        'generic high',
        'generic low'
      ])
    })

    it('recognizes a requested article declared at the start of chunk content', () => {
      const results = [
        { content: 'generic', score: 0.9 },
        { content: 'Điều 8. Nội dung điều luật', score: 0.2 }
      ]

      expect(prioritizeArticleMatches(['8'], results).map((item) => item.content)).toEqual([
        'Điều 8. Nội dung điều luật',
        'generic'
      ])
    })

    it('preserves score order when no article was requested', () => {
      const results = [
        { content: 'low', score: 0.2 },
        { content: 'high', score: 0.9 }
      ]

      expect(prioritizeArticleMatches([], results).map((item) => item.content)).toEqual([
        'low',
        'high'
      ])
    })

    it('does not mutate the retrieved result list', () => {
      const results = [
        { content: 'article', score: 0.1, sectionPath: ['Điều 8'] },
        { content: 'generic', score: 0.9 }
      ]

      prioritizeArticleMatches(['8'], results)

      expect(results.map((item) => item.content)).toEqual(['article', 'generic'])
    })
  })

  describe('mergeSearchResults', () => {
    it('merges hierarchical and flat results without duplicating chunks', () => {
      const primary = [
        { chunkId: 'a', score: 0.8 },
        { chunkId: 'b', score: 0.4 }
      ]
      const flat = [
        { chunkId: 'b', score: 0.7 },
        { chunkId: 'c', score: 0.5 }
      ]

      expect(mergeSearchResults(primary, flat)).toEqual([
        { chunkId: 'a', score: 0.8 },
        { chunkId: 'b', score: 0.7 },
        { chunkId: 'c', score: 0.5 }
      ])
    })

    it('keeps a higher primary score over the flat duplicate', () => {
      const merged = mergeSearchResults(
        [{ chunkId: 'a', score: 0.9 }],
        [{ chunkId: 'a', score: 0.3 }]
      )

      expect(merged).toEqual([{ chunkId: 'a', score: 0.9 }])
    })

    it('keeps the primary copy when both passes score the same chunk equally', () => {
      const merged = mergeSearchResults(
        [{ chunkId: 'a', score: 0.5, source: 'hierarchical' }],
        [{ chunkId: 'a', score: 0.5, source: 'flat' }]
      )

      expect(merged).toEqual([{ chunkId: 'a', score: 0.5, source: 'hierarchical' }])
    })

    it('handles two empty passes without mutating them', () => {
      const primary: Array<{ chunkId: string; score: number }> = []
      const secondary: Array<{ chunkId: string; score: number }> = []

      expect(mergeSearchResults(primary, secondary)).toEqual([])
      expect(primary).toEqual([])
      expect(secondary).toEqual([])
    })
  })
})
