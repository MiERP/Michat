/**
 * Section helpers dùng chung cho loader / normalizer / chunking.
 *
 * Mục tiêu: mọi cấu trúc tài liệu (sections từ loader) đều quy về một dạng
 * "phẳng, kèm headingPath" để chunk có thể neo vào mục thay vì cắt mù.
 * Đây là kế thừa trực tiếp `SectionInfo` sẵn có của loaders, không thay thế.
 */

import type { SectionInfo } from './types'

/**
 * Section đã làm phẳng, kèm đường dẫn heading từ gốc tới nút.
 * Dùng để lưu vào `documents.metadata.structure.sections` và để tra cứu
 * heading path của từng chunk.
 */
export interface CompactSection {
  level: number
  title: string
  headingPath: string[]
  startOffset: number
  endOffset: number
}

export interface FlatSectionInput {
  level: number
  title: string
  startOffset: number
  endOffset: number
}

/**
 * Dựng cây phân cấp từ danh sách heading phẳng (theo thứ tự xuất hiện).
 * Cùng thuật toán stack đang dùng ở DocxLoader.buildHierarchy.
 */
export function buildSectionHierarchy(flat: FlatSectionInput[]): SectionInfo[] {
  const root: SectionInfo[] = []
  const stack: SectionInfo[] = []

  for (const item of flat) {
    const section: SectionInfo = {
      level: Math.min(Math.max(item.level, 1), 6),
      title: item.title,
      content: '',
      startOffset: item.startOffset,
      endOffset: item.endOffset
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= section.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.push(section)
    } else {
      const parent = stack[stack.length - 1]
      if (!parent.children) parent.children = []
      parent.children.push(section)
    }

    stack.push(section)
  }

  return root
}

/**
 * Làm phẳng cây section kèm headingPath (giữ nguyên thứ tự tài liệu).
 */
export function flattenSectionsWithPath(
  sections: SectionInfo[],
  parentPath: string[] = []
): CompactSection[] {
  const flat: CompactSection[] = []

  for (const section of sections) {
    const title = (section.title || '').trim()
    const headingPath = title ? [...parentPath, title] : parentPath

    if (
      typeof section.startOffset === 'number' &&
      typeof section.endOffset === 'number' &&
      section.endOffset > section.startOffset
    ) {
      flat.push({
        level: section.level,
        title,
        headingPath,
        startOffset: section.startOffset,
        endOffset: section.endOffset
      })
    }

    if (section.children?.length) {
      flat.push(...flattenSectionsWithPath(section.children, headingPath))
    }
  }

  return flat
}

const HEADING_LINE_REGEX = /^(#{1,6})[ \t]+(.+?)[ \t]*$/
const FENCE_LINE_REGEX = /^[ \t]*(```|~~~)/

/**
 * Suy ra cây section từ chính markdown đã lưu.
 *
 * Đây là nguồn offset "chuẩn" duy nhất: sau khi normalizer chèn heading, offset
 * do loader trả về không còn khớp content nữa, nên thay vì cố dịch offset ta
 * suy lại trực tiếp từ text sẽ được lưu. Nhờ vậy heading path của chunk không
 * bao giờ lệch khỏi nội dung thật.
 *
 * Bỏ qua heading nằm trong fenced code block (``` hoặc ~~~).
 */
export function extractSectionsFromMarkdown(content: string): SectionInfo[] {
  const flat: FlatSectionInput[] = []
  let offset = 0
  let inFence = false

  for (const line of content.split('\n')) {
    const lineStart = offset
    offset += line.length + 1

    if (FENCE_LINE_REGEX.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = HEADING_LINE_REGEX.exec(line)
    if (!match) continue

    const title = match[2].replace(/\s+#+\s*$/, '').trim()
    if (!title) continue

    flat.push({
      level: match[1].length,
      title,
      startOffset: lineStart,
      endOffset: content.length
    })
  }

  if (flat.length === 0) return []

  for (let i = 0; i < flat.length - 1; i++) {
    flat[i].endOffset = flat[i + 1].startOffset
  }

  return buildSectionHierarchy(flat)
}

/**
 * Chuẩn hóa danh sách compact section: bỏ offset không hợp lệ, sắp theo vị trí.
 * Cần thiết vì loader khác nhau có thể trả offset thiếu chính xác.
 */
export function sanitizeCompactSections(sections: CompactSection[]): CompactSection[] {
  return sections
    .filter(
      (section) =>
        Number.isFinite(section.startOffset) &&
        Number.isFinite(section.endOffset) &&
        section.startOffset >= 0 &&
        section.endOffset > section.startOffset &&
        section.title.trim().length > 0
    )
    .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)
}

/**
 * Tìm section sâu nhất (level lớn nhất) chứa offset truyền vào.
 * Chunk được neo vào section theo offset bắt đầu — khớp với cách cắt chunk
 * hiện tại (không đổi ranh giới cắt, chỉ gắn nhãn).
 */
export function findDeepestSection(
  sections: CompactSection[],
  startOffset: number
): CompactSection | undefined {
  let best: CompactSection | undefined

  for (const section of sections) {
    if (startOffset >= section.startOffset && startOffset < section.endOffset) {
      if (!best || section.level >= best.level) best = section
    }
  }

  return best
}
