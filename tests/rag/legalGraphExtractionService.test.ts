import type { LanguageModel } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chunk, Document } from '../../src/main/db/schema'
import { LegalGraphExtractionService } from '../../src/main/services/legalGraph/LegalGraphExtractionService'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock
}))

const document = {
  id: 'document-1',
  notebookId: 'notebook-1',
  title: 'Law source',
  type: 'text',
  sourceUri: null,
  localFilePath: null,
  sourceNoteId: null,
  content: null,
  contentHash: null,
  mimeType: null,
  fileSize: null,
  metadata: {},
  status: 'indexed',
  errorMessage: null,
  chunkCount: 1,
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  updatedAt: new Date('2026-07-22T00:00:00.000Z')
} satisfies Document

const chunk = {
  id: 'chunk-1',
  documentId: document.id,
  notebookId: document.notebookId,
  content: '1. Doanh nghi\u1ec7p ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1 trong 10 ng\u00e0y.',
  chunkIndex: 0,
  startOffset: 100,
  endOffset: 148,
  metadata: {
    legalContext: {
      articleNumber: '15',
      articleTitle: 'Deadline',
      clauseNumber: '1'
    }
  },
  tokenCount: 20,
  createdAt: new Date('2026-07-22T00:00:00.000Z')
} satisfies Chunk

const activeModel = {
  model: { modelId: 'local-test-model' } as LanguageModel,
  provenance: 'llama:local-test-model'
}

const validOutput = {
  nodes: [
    {
      localId: 'subject-1',
      type: 'subject',
      label: 'Doanh nghi\u1ec7p',
      aliases: []
    },
    {
      localId: 'action-1',
      type: 'action',
      label: 'n\u1ed9p h\u1ed3 s\u01a1 trong 10 ng\u00e0y',
      aliases: []
    }
  ],
  relations: [
    {
      source: 'subject-1',
      target: 'action-1',
      type: 'requires',
      confidence: 0.91,
      evidenceText: 'ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1'
    }
  ]
}

describe('LegalGraphExtractionService', () => {
  beforeEach(() => generateTextMock.mockReset())

  it('accepts evidence-backed closed triples', async () => {
    generateTextMock.mockResolvedValue({ experimental_output: validOutput })

    const candidate = await new LegalGraphExtractionService().extractDocument(
      document,
      [chunk],
      activeModel
    )

    expect(candidate.sourceUnitCount).toBe(1)
    expect(candidate.processedUnitCount).toBe(1)
    expect(candidate.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeType: 'document' }),
        expect.objectContaining({ nodeType: 'article', articleNumber: '15' }),
        expect.objectContaining({ nodeType: 'clause', clauseNumber: '1' })
      ])
    )
    expect(candidate.relations).toEqual([
      expect.objectContaining({
        relationType: 'requires',
        evidenceChunkId: chunk.id,
        evidenceText: 'ph\u1ea3i n\u1ed9p h\u1ed3 s\u01a1',
        evidenceStartOffset: 116,
        evidenceEndOffset: 130
      })
    ])
  })

  it('rejects invented evidence', async () => {
    generateTextMock.mockResolvedValue({
      experimental_output: {
        ...validOutput,
        relations: [{ ...validOutput.relations[0], evidenceText: 'invented quote' }]
      }
    })

    await expect(
      new LegalGraphExtractionService().extractDocument(document, [chunk], activeModel)
    ).rejects.toThrow('Evidence text is not present in source chunk')
  })

  it('rejects unknown predicates even when provider bypasses structured validation', async () => {
    generateTextMock.mockResolvedValue({
      experimental_output: {
        ...validOutput,
        relations: [{ ...validOutput.relations[0], type: 'causes' }]
      }
    })

    await expect(
      new LegalGraphExtractionService().extractDocument(document, [chunk], activeModel)
    ).rejects.toThrow()
  })

  it('rejects relations with unknown endpoints', async () => {
    generateTextMock.mockResolvedValue({
      experimental_output: {
        ...validOutput,
        relations: [{ ...validOutput.relations[0], target: 'missing-node' }]
      }
    })

    await expect(
      new LegalGraphExtractionService().extractDocument(document, [chunk], activeModel)
    ).rejects.toThrow('Legal graph relation references an unknown extracted node')
  })

  it('requires every chunk to belong to the source document and notebook', async () => {
    await expect(
      new LegalGraphExtractionService().extractDocument(
        document,
        [{ ...chunk, notebookId: 'other-notebook' }],
        activeModel
      )
    ).rejects.toThrow('Legal graph source crosses document or notebook boundary')
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
