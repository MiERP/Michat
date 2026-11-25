/**
 * MarkdownNormalizer
 * Chuẩn hóa nội dung tài liệu thành markdown có cấu trúc (heading thật).
 *
 * Mục tiêu: mọi nội dung vào KB đều có dạng canonical markdown để:
 *  - Chunking có neo heading thay vì cắt mù giữa đoạn
 *  - LLM local đọc RAG context tốt hơn
 *  - Block-level diff (incremental reindex) dựa trên cấu trúc ổn định
 *
 * Các loader (PDF/DOCX) tự chèn heading khi parse; stage này là lưới an toàn
 * cho nội dung text thô kèm structure.sections mà chưa có marker heading.
 *
 * Quan trọng: sau bước này, `structure.sections` LUÔN được suy lại từ chính
 * content sẽ lưu (xem extractSectionsFromMarkdown) — nên offset section và
 * offset chunk cùng nằm trên một hệ toạ độ.
 */

import type { DocumentLoadResult, SectionInfo } from './loaders/types'
import { extractSectionsFromMarkdown } from './loaders/sections'

const HEADING_REGEX = /^#{1,6}\s+\S/m
const LEGAL_ARTICLE_LINE_REGEX = /^\s*Điều\s+\d+[a-z]?(?:\s*$|[.:]\s*\S)/gim

export class MarkdownNormalizer {
  /**
   * Chuẩn hóa DocumentLoadResult. Không sửa đổi object gốc.
   */
  normalize(result: DocumentLoadResult): DocumentLoadResult {
    const legal = this.insertLegalHeadings(result.content ?? '')
    const content = legal.content
    const structure = this.shiftPageOffsets(result.structure, legal.insertions)

    // 1. Content đã có heading marker (PDF heuristic, DOCX turndown, .md nguồn):
    //    chỉ cần suy lại sections từ chính content, không chèn gì thêm.
    //    Vẫn giữ type 'pages' khi tài liệu có cấu trúc trang (số trang là thông
    //    tin quý, không được đánh mất chỉ vì tài liệu cũng có heading).
    if (this.hasMarkdownHeadings(content)) {
      const derived = extractSectionsFromMarkdown(content)
      if (derived.length === 0) return result

      const hasPages = !!structure?.pages?.length
      return {
        ...result,
        content,
        structure: {
          ...(structure ?? {}),
          type: hasPages ? (structure?.type ?? 'pages') : 'sections',
          sections: derived
        }
      }
    }

    // 2. Content thô nhưng loader có cấu trúc sections → chèn marker heading rồi
    //    suy lại sections từ content mới (offset loader không còn dùng nữa).
    const sections = structure?.sections
    if (!sections || sections.length === 0) return result

    const normalized = this.insertHeadingsAtOffsets(content, sections)
    if (normalized === content) return result

    const derived = extractSectionsFromMarkdown(normalized)
    return {
      ...result,
      content: normalized,
      structure: derived.length > 0 ? { ...structure, sections: derived } : structure
    }
  }

  hasMarkdownHeadings(content: string): boolean {
    return HEADING_REGEX.test(content)
  }

  /**
   * Văn bản luật Việt Nam thường dùng "Chương/Mục/Điều" in đậm cùng cỡ chữ với
   * body, nên PdfLoader không nhận ra heading. Bổ sung marker markdown để
   * chunking và section index hoạt động. Trả thêm vị trí/độ dài marker để dịch
   * offset trang sau khi chèn.
   */
  private insertLegalHeadings(content: string): {
    content: string
    insertions: Array<{ offset: number; delta: number }>
  } {
    if (!this.looksLikeLegalDocument(content)) return { content, insertions: [] }

    const insertions: Array<{ offset: number; delta: number }> = []
    let offset = 0
    let changed = false

    const lines = content.split('\n').map((line) => {
      const lineStart = offset
      offset += line.length + 1

      if (/^#{1,6}[ \t]+/.test(line)) return line

      const trimmed = line.trim()
      if (!trimmed || trimmed.length > 160) return line

      const level = this.legalHeadingLevel(trimmed)
      if (level === null) return line

      const marker = `${'#'.repeat(level)} `
      insertions.push({
        offset: lineStart,
        delta: marker.length - (line.length - trimmed.length)
      })
      changed = true
      return `${marker}${trimmed}`
    })

    return {
      content: changed ? lines.join('\n') : content,
      insertions: changed ? insertions : []
    }
  }

  private legalHeadingLevel(line: string): number | null {
    if (this.isTocLike(line)) return null

    const chapter = /^(Chương)\s+([0-9]+|[IVXLC]+)(.*)$/iu.exec(line)
    if (chapter && this.isHeadingTitleRest(chapter[3])) return 1

    const section = /^(Mục)\s+(\d+)(.*)$/iu.exec(line)
    if (section && this.isHeadingTitleRest(section[3])) return 2

    if (/^(Điều)\s+(\d+[a-z]?)[.:]\s*\S/iu.test(line)) return 3
    // Consolidated legal PDFs often put the article number on its own line.
    if (/^(Điều)\s+(\d+[a-z]?)\s*$/iu.test(line)) return 3

    return null
  }

  /**
   * Reject table-of-contents rows such as "Điều 1. Phạm vi ....... 3" or
   * "Điều 1. Phạm vi   3" so the TOC does not become real sections.
   */
  private isTocLike(line: string): boolean {
    return (
      /(?:\.{2,}|…{2,}|·{2,})\s*\d+\s*$/u.test(line) ||
      /\s{2,}\d+\s*$/u.test(line) ||
      /^Điều\b.*[.:]\s+\S.*\s+\d{1,4}\s*$/u.test(line)
    )
  }

  private isHeadingTitleRest(rest: string): boolean {
    const trimmed = rest.trim()
    if (!trimmed) return true
    const first = trimmed[0]
    return first === '-' || first === ':' || first === '.' || /\p{Lu}/u.test(first)
  }

  /**
   * Dịch offset trang theo các marker đã chèn. Marker nằm trong trang nên
   * startOffset không đổi khi marker đúng ở đầu trang; endOffset và các trang
   * sau dịch đủ độ dài marker.
   */
  private shiftPageOffsets(
    structure: DocumentLoadResult['structure'],
    insertions: Array<{ offset: number; delta: number }>
  ): DocumentLoadResult['structure'] {
    if (!structure?.pages?.length || insertions.length === 0) return structure

    const shift = (offset: number): number =>
      insertions.reduce((sum, item) => (item.offset < offset ? sum + item.delta : sum), 0)

    return {
      ...structure,
      pages: structure.pages.map((page) => ({
        ...page,
        startOffset: page.startOffset + shift(page.startOffset),
        endOffset: page.endOffset + shift(page.endOffset)
      }))
    }
  }

  private looksLikeLegalDocument(content: string): boolean {
    return (content.match(LEGAL_ARTICLE_LINE_REGEX)?.length ?? 0) >= 3
  }

  /**
   * Chèn marker `#` vào vị trí heading dựa trên offsets của SectionInfo.
   * Chèn từ cuối lên đầu để offsets phía trước không bị dịch.
   * Bỏ qua heading có offset không khớp (title không nằm đúng vị trí) —
   * vì vậy offset từ loader sai định dạng sẽ không tạo ra heading giả.
   */
  private insertHeadingsAtOffsets(content: string, sections: SectionInfo[]): string {
    const flat = this.flattenSections(sections)
    const insertions: Array<{ offset: number; marker: string }> = []

    for (const section of flat) {
      const { level, title, startOffset } = section
      if (typeof startOffset !== 'number' || startOffset < 0) continue
      if (!title || !title.trim()) continue

      const actual = content.slice(startOffset, startOffset + title.length)
      if (actual !== title) continue

      insertions.push({
        offset: startOffset,
        marker: `${'#'.repeat(Math.min(Math.max(level, 1), 6))} `
      })
    }

    if (insertions.length === 0) return content

    insertions.sort((a, b) => b.offset - a.offset)

    let result = content
    for (const { offset, marker } of insertions) {
      result = result.slice(0, offset) + marker + result.slice(offset)
    }

    return result
  }

  private flattenSections(sections: SectionInfo[]): SectionInfo[] {
    const flat: SectionInfo[] = []
    const walk = (list: SectionInfo[]): void => {
      for (const section of list) {
        flat.push(section)
        if (section.children?.length) walk(section.children)
      }
    }
    walk(sections)
    return flat
  }
}
