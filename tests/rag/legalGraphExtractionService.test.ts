import { describe, expect, it } from 'vitest'
import type { Chunk, Document } from '../../src/main/db/schema'
import { LegalGraphExtractionService } from '../../src/main/services/legalGraph/LegalGraphExtractionService'

const document = {
  id: 'document-1',
  notebookId: 'notebook-1',
  title: 'Luật thử nghiệm',
  type: 'text',
  sourceUri: null,
  localFilePath: null,
  sourceNoteId: null,
  content: null,
  contentHash: null,
  mimeType: null,
  fileSize: null,
  metadata: {
    canonicalLegalWorkKey: 'luật:12/2026/QH15',
    legalDocument: {
      documentNumber: '12/2026/QH15',
      documentType: 'Luật',
      status: 'unknown',
      amendsDocumentIds: [],
      replacesDocumentIds: [],
      repealedByDocumentIds: []
    }
  },
  status: 'indexed',
  errorMessage: null,
  chunkCount: 2,
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  updatedAt: new Date('2026-07-22T00:00:00.000Z')
} satisfies Document

function legalChunk(
  id: string,
  articleNumber: string,
  content: string,
  startOffset: number
): Chunk {
  return {
    id,
    documentId: document.id,
    notebookId: document.notebookId,
    content,
    chunkIndex: Number(articleNumber),
    startOffset,
    endOffset: startOffset + content.length,
    metadata: {
      kind: 'legal-content',
      legalContext: { articleNumber, articleTitle: `Điều ${articleNumber}` }
    },
    tokenCount: 20,
    createdAt: new Date('2026-07-22T00:00:00.000Z')
  }
}

describe('LegalGraphExtractionService', () => {
  it('builds deterministic structural nodes and evidence-backed internal references', async () => {
    const chunks = [
      legalChunk('chunk-15', '15', 'Điều 15. Thực hiện theo Điều 16 của Luật này.', 100),
      legalChunk('chunk-16', '16', 'Điều 16. Trách nhiệm thi hành.', 200)
    ]
    const progress: Array<[number, number]> = []

    const candidate = await new LegalGraphExtractionService().extractDocument(
      document,
      chunks,
      undefined,
      (processed, total) => progress.push([processed, total])
    )

    expect(candidate).toMatchObject({ sourceUnitCount: 2, processedUnitCount: 2 })
    expect(candidate.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeType: 'document', canonicalKey: 'document:luật:12/2026/QH15' }),
        expect.objectContaining({ nodeType: 'article', articleNumber: '15' }),
        expect.objectContaining({ nodeType: 'article', articleNumber: '16' })
      ])
    )
    expect(candidate.relations).toEqual([
      expect.objectContaining({
        relationType: 'references',
        evidenceChunkId: 'chunk-15',
        evidenceText: 'Điều 16',
        confidence: 1
      })
    ])
    expect(progress).toEqual([
      [1, 2],
      [2, 2]
    ])
  })

  it('uses canonical legal work identity across physical source variants', async () => {
    const first = await new LegalGraphExtractionService().extractDocument(document, [
      legalChunk('chunk-15', '15', 'Điều 15. Quyền của chủ thể.', 100)
    ])
    const secondDocument = { ...document, id: 'document-2' }
    const secondChunk = {
      ...legalChunk('chunk-15-pdf', '15', 'Điều 15. Quyền của chủ thể.', 100),
      documentId: secondDocument.id
    }
    const second = await new LegalGraphExtractionService().extractDocument(secondDocument, [secondChunk])

    expect(first.nodes.find((node) => node.nodeType === 'article')?.canonicalKey).toBe(
      second.nodes.find((node) => node.nodeType === 'article')?.canonicalKey
    )
  })

  it('rejects chunks crossing document or notebook boundaries', async () => {
    await expect(
      new LegalGraphExtractionService().extractDocument(document, [
        { ...legalChunk('chunk-15', '15', 'Điều 15. Nội dung.', 100), notebookId: 'other' }
      ])
    ).rejects.toThrow('Legal graph source crosses document or notebook boundary')
  })

  it('extracts evidence-backed Vietnamese obligation and sanction semantics', async () => {
    const candidate = await new LegalGraphExtractionService().extractDocument(document, [
      legalChunk(
        'chunk-20',
        '20',
        'Điều 20. Doanh nghiệp phải nộp hồ sơ đúng hạn. Doanh nghiệp vi phạm bị phạt tiền từ 10.000.000 đồng.',
        300
      )
    ])

    expect(candidate.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeType: 'subject', label: 'Doanh nghiệp' }),
        expect.objectContaining({ nodeType: 'action', label: 'nộp hồ sơ đúng hạn' }),
        expect.objectContaining({ nodeType: 'sanction', label: expect.stringContaining('phạt tiền') })
      ])
    )
    expect(candidate.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationType: 'requires', evidenceChunkId: 'chunk-20' }),
        expect.objectContaining({ relationType: 'sanction_for', evidenceChunkId: 'chunk-20' })
      ])
    )
  })
})
