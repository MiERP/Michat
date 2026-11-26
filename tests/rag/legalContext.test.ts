import { describe, expect, it } from 'vitest'
import {
  extractDefinitionTerm,
  mergeOverlappingChunks,
  namesSpecificLaw,
  trimOverlappingPrefix
} from '../../src/main/services/rag/legalContext'

describe('legal context helpers', () => {
  it('extracts the defined term from a definition question', () => {
    expect(extractDefinitionTerm('Luật Dữ liệu định nghĩa dữ liệu quan trọng là gì?')).toBe(
      'dữ liệu quan trọng'
    )
    expect(extractDefinitionTerm('Thế nào là dữ liệu cốt lõi?')).toBe('dữ liệu cốt lõi')
    expect(extractDefinitionTerm('Dữ liệu mở là gì?')).toBe('Dữ liệu mở')
    expect(extractDefinitionTerm('Dữ liệu quan trọng được định nghĩa là gì?')).toBe(
      'Dữ liệu quan trọng'
    )
    expect(extractDefinitionTerm('Định nghĩa tại Điều 3, dữ liệu quan trọng là gì?')).toBe(
      'dữ liệu quan trọng'
    )
    expect(extractDefinitionTerm('Định nghĩa dữ liệu quan trọng')).toBe('dữ liệu quan trọng')
    expect(extractDefinitionTerm('Luật này có hiệu lực từ ngày nào?')).toBeNull()
  })

  it('merges chunks by source offsets without duplicating overlap', () => {
    const merged = mergeOverlappingChunks([
      {
        content: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        startOffset: 0,
        endOffset: 36
      },
      {
        content: 'QRSTUVWXYZ0123456789abcdefghijklmnop',
        startOffset: 26,
        endOffset: 62
      }
    ])

    expect(merged).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnop')
  })

  it('keeps a definition split across two chunks complete', () => {
    const merged = mergeOverlappingChunks([
      {
        content:
          '6. Dữ liệu quan trọng là dữ liệu có thể tác động đến quốc phòng, an ninh, đối ngoại, kinh tế vĩ',
        startOffset: 100,
        endOffset: 220
      },
      {
        content:
          'n ninh, đối ngoại, kinh tế vĩ mô, ổn định xã hội, sức khỏe và an toàn cộng đồng thuộc danh mục do Thủ tướng Chính phủ ban hành.',
        startOffset: 200,
        endOffset: 320
      }
    ])

    expect(merged).toContain(
      'Dữ liệu quan trọng là dữ liệu có thể tác động đến quốc phòng, an ninh, đối ngoại, kinh tế vĩ mô'
    )
    expect(merged.match(/kinh tế vĩ mô/gu)).toHaveLength(1)
  })

  it('removes a repeated list item when adjacent chunks overlap', () => {
    const merged = mergeOverlappingChunks([
      {
        content:
          'a) Xây dựng và tổ chức thực hiện chính sách, quy định bảo vệ dữ liệu;\nb) Quản lý hoạt động xử lý dữ liệu;\nc) Xây dựng và triển khai các giải pháp kỹ thuật;',
        startOffset: 0,
        endOffset: 200
      },
      {
        content:
          'khai các giải pháp kỹ thuật;\nd) Đào tạo, bồi dưỡng, phát triển, quản lý nguồn nhân lực;\nđ) Các biện pháp bảo vệ dữ liệu khác.',
        startOffset: 160,
        endOffset: 320
      }
    ])

    expect(merged.match(/triển khai các giải pháp kỹ thuật/gu)).toHaveLength(1)
    expect(merged).toContain('d) Đào tạo, bồi dưỡng')
  })

  it('trims a shared prefix as a fallback when offsets are unavailable', () => {
    expect(
      trimOverlappingPrefix(
        ['c) Xây dựng và triển khai các giải pháp kỹ thuật;'],
        'khai các giải pháp kỹ thuật; d) Đào tạo, bồi dưỡng'
      )
    ).toBe('d) Đào tạo, bồi dưỡng')
  })

  it('returns an empty string for no chunks and leaves a single chunk unchanged', () => {
    expect(mergeOverlappingChunks([])).toBe('')

    const single = { content: 'Điều 3. Giải thích từ ngữ', startOffset: 0, endOffset: 26 }
    expect(mergeOverlappingChunks([single])).toBe(single.content)
  })

  it('orders chunks by start offset before merging', () => {
    const merged = mergeOverlappingChunks([
      { content: 'klmnopqrstuvwxyzABCDEF', startOffset: 20, endOffset: 40 },
      { content: '0123456789abcdefghijklmnopqrstuvwxyz', startOffset: 0, endOffset: 36 }
    ])

    expect(merged).toBe('0123456789abcdefghijklmnopqrstuvwxyzABCDEF')
  })

  it('keeps both chunks when there is no shared text', () => {
    const merged = mergeOverlappingChunks([
      { content: 'Điều 3. Giải thích từ ngữ', startOffset: 0, endOffset: 26 },
      { content: 'Điều 4. Nội dung khác', startOffset: 500, endOffset: 522 }
    ])

    expect(merged).toBe('Điều 3. Giải thích từ ngữĐiều 4. Nội dung khác')
  })

  it('merges a 12-character overlap but keeps an 11-character repeat', () => {
    const merged = mergeOverlappingChunks([
      { content: 'xxxxABCDEFGHIJKL', startOffset: 0, endOffset: 16 },
      { content: 'ABCDEFGHIJKLy', startOffset: 4, endOffset: 17 }
    ])
    expect(merged).toBe('xxxxABCDEFGHIJKLy')

    // Below the minimum overlap the chunks are concatenated as-is; this
    // avoids treating a short repeated phrase as a duplicated clause.
    const shortRepeat = mergeOverlappingChunks([
      { content: 'xxxxxABCDEFGHIJK', startOffset: 0, endOffset: 16 },
      { content: 'ABCDEFGHIJKy', startOffset: 5, endOffset: 17 }
    ])
    expect(shortRepeat).toBe('xxxxxABCDEFGHIJKABCDEFGHIJKy')
  })

  it('leaves text unchanged when there is no prefix to trim', () => {
    expect(trimOverlappingPrefix([], 'a) Mục một;')).toBe('a) Mục một;')
    expect(trimOverlappingPrefix(['a) Mục một;'], '')).toBe('')
    expect(trimOverlappingPrefix(['a) Mục một;'], 'b) Mục hai;')).toBe('b) Mục hai;')
    // Repeats shorter than the 8-character minimum are not treated as overlap.
    expect(trimOverlappingPrefix(['Khoản 2 dữ liệu'], 'dữ liệu quan trọng')).toBe(
      'dữ liệu quan trọng'
    )
  })

  it('trims against any earlier chunk in the same section', () => {
    expect(
      trimOverlappingPrefix(
        ['a) Mục một;', 'b) Quản lý hoạt động xử lý dữ liệu;'],
        'xử lý dữ liệu; c) Mục ba'
      )
    ).toBe('c) Mục ba')
  })

  it('compares only against the most recent chunks of the section', () => {
    const old = 'Quản lý dữ liệu là quá trình;'
    // The matching text sits four entries back, outside the recent window.
    expect(
      trimOverlappingPrefix(
        [old, 'x) Mục xa một;', 'y) Mục xa hai;', 'z) Mục xa ba;'],
        `${old} phần còn lại`
      )
    ).toBe(`${old} phần còn lại`)
    // Inside the window the trim still fires.
    expect(
      trimOverlappingPrefix(['x) Mục xa một;', 'y) Mục xa hai;', old], `${old} phần còn lại`)
    ).toBe('phần còn lại')
  })

  it('rejects empty queries and terms that are too short', () => {
    expect(extractDefinitionTerm('')).toBeNull()
    expect(extractDefinitionTerm('   ')).toBeNull()
    expect(extractDefinitionTerm('X là gì?')).toBeNull()
  })

  it('separates a named law from a generic reference', () => {
    expect(namesSpecificLaw('Luật Dữ liệu có hiệu lực từ ngày nào?')).toBe(true)
    expect(namesSpecificLaw('Luật SHTT có hiệu lực từ ngày nào?')).toBe(true)
    expect(namesSpecificLaw('Luật số 60/2024/QH15 có hiệu lực từ ngày nào?')).toBe(true)
    // "Luật Không Tồn Tại" is a (fictional) law name, not a negation.
    expect(namesSpecificLaw('Theo Luật Không Tồn Tại, Điều 10 quy định gì?')).toBe(true)

    // Generic pronouns and the common interrogative/verb openings must keep
    // the seed document instead of forcing an empty structural retrieval.
    expect(namesSpecificLaw('Luật này có hiệu lực từ ngày nào?')).toBe(false)
    expect(namesSpecificLaw('Luật hiện hành quy định gì?')).toBe(false)
    expect(namesSpecificLaw('Luật sửa đổi có hiệu lực từ ngày nào?')).toBe(false)
    expect(namesSpecificLaw('Luật nào quy định về dữ liệu cá nhân?')).toBe(false)
    expect(namesSpecificLaw('Luật có hiệu lực từ khi nào?')).toBe(false)
    expect(namesSpecificLaw('Luật gồm những điều gì?')).toBe(false)
    expect(namesSpecificLaw('Theo pháp luật Việt Nam, thời hạn là bao lâu?')).toBe(false)
    expect(namesSpecificLaw('Theo pháp luật, thời hạn giải quyết là bao lâu?')).toBe(false)
  })

  it('extracts the term from a question that names the law first', () => {
    expect(extractDefinitionTerm('Theo Luật Dữ liệu, dữ liệu quan trọng là gì?')).toBe(
      'dữ liệu quan trọng'
    )
  })

  it('extracts the term from a bare definition request', () => {
    expect(extractDefinitionTerm('Định nghĩa dữ liệu mở')).toBe('dữ liệu mở')
    expect(extractDefinitionTerm('Giải thích từ ngữ dữ liệu cốt lõi')).toBe('dữ liệu cốt lõi')
  })
})
