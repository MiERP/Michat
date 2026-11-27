import { describe, expect, it } from 'vitest'
import {
  buildEmptyKnowledgeBaseReply,
  buildNoEvidenceInstruction,
  buildRAGContext,
  type RagSearchResult
} from '../../src/main/services/rag/promptContext'

function result(overrides: Partial<RagSearchResult> & { content: string }): RagSearchResult {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'Luật Sở hữu trí tuệ',
    score: 0.9,
    ...overrides
  }
}

describe('grounding fallbacks', () => {
  it('returns a Vietnamese refusal for an empty notebook by default', () => {
    expect(buildEmptyKnowledgeBaseReply('vi-VN')).toContain('chưa có nội dung')
    expect(buildEmptyKnowledgeBaseReply(undefined)).toContain('cơ sở tri thức')
  })

  it('returns an English refusal for an empty notebook', () => {
    expect(buildEmptyKnowledgeBaseReply('en-US')).toContain('no indexed content')
  })

  it('forbids general-knowledge answers when retrieval finds no evidence', () => {
    const instruction = buildNoEvidenceInstruction('vi-VN')
    expect(instruction).toContain('Do NOT answer from your own general knowledge')
    expect(instruction).toContain('Vietnamese')
    expect(instruction).toContain('Do not fabricate')
    expect(buildNoEvidenceInstruction('en-US')).toContain('English')
  })
})

describe('buildRAGContext', () => {
  it('returns an empty context for no results', () => {
    const { context, includedChunkIds, marker } = buildRAGContext([])
    expect(context).toBe('')
    expect(includedChunkIds.size).toBe(0)
    expect(marker).toBe('')
  })

  it('wraps chunks in the untrusted marker with citation ids', () => {
    const { context, marker } = buildRAGContext([result({ content: 'Điều 3. Giải thích từ ngữ' })])
    expect(marker).toContain('untrusted_documents_')
    expect(context).toContain(`<${marker}>`)
    expect(context).toContain('</' + marker + '>')
    expect(context).toContain('<doc id="1" chunk="chunk-1"')
    expect(context).toContain('Điều 3. Giải thích từ ngữ')
  })

  it('deduplicates repeated sections into one doc block', () => {
    const { context } = buildRAGContext([
      result({ chunkId: 'c1', content: 'Điều 8. A', sectionPath: ['Điều 8'] }),
      result({ chunkId: 'c2', content: 'Điều 8. B', sectionPath: ['Điều 8'] })
    ])
    const docBlocks = context.match(/<doc id="\d+"/g) ?? []
    expect(docBlocks).toHaveLength(1)
    expect(context).toContain('Điều 8. A')
    expect(context).not.toContain('Điều 8. B')
  })

  it('keeps a distinct matched passage on the second visit and trims overlap once', () => {
    const overlap = 'Dữ liệu quan trọng là '
    const { context } = buildRAGContext(
      [
        result({
          chunkId: 'c1',
          content: `${overlap}thông tin dưới dạng dữ liệu số.`,
          sectionPath: ['Điều 3'],
          matchedContent: 'thông tin dưới dạng dữ liệu số.'
        }),
        result({
          chunkId: 'c2',
          content: `${overlap}hệ thống thông tin quan trọng của quốc gia.`,
          sectionPath: ['Điều 3'],
          matchedContent: 'hệ thống thông tin quan trọng của quốc gia.'
        })
      ],
      { dedupeSections: false }
    )
    // Both matched passages survive; the overlap prefix is only carried once.
    expect(context).toContain('thông tin dưới dạng dữ liệu số.')
    expect(context).toContain('hệ thống thông tin quan trọng của quốc gia.')
    expect(context.match(/Dữ liệu quan trọng là /g)).toHaveLength(1)
  })

  it('keeps a continuation chunk whose anchor starts inside the trimmed overlap', () => {
    // The previous chunk ends with exactly the text that opens the next
    // chunk's matched passage. The overlap must be removed once, the anchor
    // must follow it, and the continuation must not be dropped.
    const shared = 'Bảo hiểm xã hội là bảo hiểm bắt buộc'
    const { context } = buildRAGContext(
      [
        result({
          chunkId: 'c1',
          content: `Điều 3. Các loại bảo hiểm.\n...\n1. ${shared}`,
          sectionPath: ['Điều 3']
        }),
        result({
          chunkId: 'c2',
          content: `${shared} áp dụng với người lao động.`,
          sectionPath: ['Điều 3'],
          matchedContent: `${shared} áp dụng với người lao động.`
        })
      ],
      { dedupeSections: false }
    )
    expect(context).toContain('áp dụng với người lao động.')
    expect(context.match(/Bảo hiểm xã hội là bảo hiểm bắt buộc/gu)).toHaveLength(1)
  })

  it('stops at the total token budget and keeps citation ids aligned', () => {
    const big = 'khoản '.repeat(600) // ~ well above the per-doc cap when repeated
    const { context, includedChunkIds } = buildRAGContext(
      Array.from({ length: 8 }, (_, index) =>
        result({
          chunkId: `c${index}`,
          documentId: `doc-${index}`,
          content: `${big}Điều ${index + 1}.`
        })
      )
    )
    expect(context).toContain('Điều 1.')
    expect(includedChunkIds.size).toBeGreaterThan(0)
    expect(includedChunkIds.size).toBeLessThan(8)
    // ids are sequential over the included docs only
    for (let id = 1; id <= includedChunkIds.size; id += 1) {
      expect(context).toContain(`<doc id="${id}"`)
    }
    expect(context).not.toContain(`<doc id="${includedChunkIds.size + 1}"`)
  })

  it('moves the matched passage to the front of a section-less doc', () => {
    const { context } = buildRAGContext([
      result({
        chunkId: 'c1',
        content: 'Trước.\n...\nGiữa.\n...\nSau.',
        matchedContent: 'Giữa.'
      })
    ])
    const body = context.slice(context.indexOf('<doc '))
    expect(body.indexOf('Giữa.')).toBeLessThan(body.indexOf('Trước.'))
    expect(body).toContain('[Surrounding context from the same document]')
  })

  it('escapes metadata attributes and keeps legal metadata in the tag', () => {
    const { context } = buildRAGContext([
      result({
        documentTitle: 'Luật <SHTT> & "2022"',
        pageNumber: 7,
        metadata: {
          documentMetadata: {
            documentNumber: '07/2022/QH15',
            documentType: 'luật',
            issuer: 'Quốc hội',
            issuedAt: '2022-06-20'
          }
        },
        content: 'Điều 1.'
      })
    ])
    expect(context).toContain('title="Luật &lt;SHTT> &amp; &quot;2022&quot;"')
    expect(context).toContain('number="07/2022/QH15"')
    expect(context).toContain('type="luật"')
    expect(context).toContain('issuer="Quốc hội"')
    expect(context).toContain('issued="2022-06-20"')
    expect(context).toContain('page="7"')
  })

  it('escapes section paths in the doc attributes', () => {
    const { context } = buildRAGContext([
      result({
        content: 'Nội dung',
        sectionPath: ['Chương <X>', 'Điều 1']
      })
    ])
    expect(context).toContain('section="Chương &lt;X> > Điều 1"')
  })
})
