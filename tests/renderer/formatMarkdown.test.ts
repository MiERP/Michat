import { describe, expect, it } from 'vitest'
import { preserveLegalLineBreaks } from '../../src/renderer/src/components/notebook/chat/formatMarkdown'

describe('preserveLegalLineBreaks', () => {
  it('turns a newline before a lettered sub-item into a markdown hard break', () => {
    const input = '1. Nhóm chính:\n    a) Mục một;\n    b) Mục hai;'
    const output = preserveLegalLineBreaks(input)

    expect(output).toContain('1. Nhóm chính:  \n    a) Mục một;')
    expect(output).toContain(';  \n    b) Mục hai;')
  })

  it('leaves ordinary paragraph wrapping untouched', () => {
    const input = 'Một câu bình thường\nvẫn là cùng một đoạn văn.'
    expect(preserveLegalLineBreaks(input)).toBe(input)
  })

  it('does not modify fenced code blocks', () => {
    const input = '```\n1. code\n    a) literal\n```'
    expect(preserveLegalLineBreaks(input)).toBe(input)
  })

  it('handles uppercase and Vietnamese lettered sub-items', () => {
    const input = 'Các mục:\n    A) Mục một;\n    Đ) Mục hai;'

    expect(preserveLegalLineBreaks(input)).toBe('Các mục:  \n    A) Mục một;  \n    Đ) Mục hai;')
  })

  it('does not add a break for a lettered item mentioned inside a sentence', () => {
    const input = 'Xem mục a) trong quy định\nvà làm theo hướng dẫn.'
    expect(preserveLegalLineBreaks(input)).toBe(input)
  })
})
