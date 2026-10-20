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

export class MarkdownNormalizer {
  /**
   * Chuẩn hóa DocumentLoadResult. Không sửa đổi object gốc.
   */
  normalize(result: DocumentLoadResult): DocumentLoadResult {
    const content = result.content ?? ''
    const structure = result.structure

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
