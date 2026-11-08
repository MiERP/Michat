import { getSqlite } from '../db'
import { normalizeMetadataValue } from '../utils/queryMetadata'
import type { RetrievalPlanningDocument } from './RetrievalPlanner'

const INDEXED_FIELDS = [
  'documentNumber',
  'documentType',
  'issuer',
  'issuedAt',
  'documentTitle'
] as const

const MULTI_VALUE_FIELDS = ['keywords', 'entities', 'tags'] as const

/** Keeps a small relational projection for metadata predicates; documents.metadata stays canonical. */
export class DocumentMetadataIndexService {
  /**
   * Reads the relational projection used by query planning. This avoids
   * deserializing every documents.metadata JSON value on each question while
   * retaining documents that have no extracted metadata through the LEFT JOIN.
   */
  listForPlanning(notebookId: string, documentIds?: string[]): RetrievalPlanningDocument[] {
    const sqlite = getSqlite()
    if (!sqlite) return []
    if (documentIds && documentIds.length === 0) return []

    const documentScope = documentIds?.length
      ? ` AND d.id IN (${documentIds.map(() => '?').join(', ')})`
      : ''

    const rows = sqlite
      .prepare(
        `SELECT d.id, m.field, m.value_display
         FROM documents d
         LEFT JOIN document_metadata_values m
           ON m.document_id = d.id
          AND m.field IN (
            'documentNumber', 'documentType', 'issuer', 'issuedAt', 'documentTitle',
            'keywords', 'entities', 'tags'
          )
         WHERE d.notebook_id = ? AND d.status = 'indexed'${documentScope}
         ORDER BY d.id`
      )
      .all(notebookId, ...(documentIds ?? [])) as Array<{
      id: string
      field: string | null
      value_display: string | null
    }>

    const byDocument = new Map<
      string,
      {
        documentMetadata: Record<string, string>
        keywords: string[]
        entities: string[]
        tags: string[]
      }
    >()
    for (const row of rows) {
      const projection = byDocument.get(row.id) ?? {
        documentMetadata: {},
        keywords: [],
        entities: [],
        tags: []
      }
      if (row.field && row.value_display) {
        if ((MULTI_VALUE_FIELDS as readonly string[]).includes(row.field)) {
          projection[row.field as (typeof MULTI_VALUE_FIELDS)[number]].push(row.value_display)
        } else {
          projection.documentMetadata[row.field] = row.value_display
        }
      }
      byDocument.set(row.id, projection)
    }

    return [...byDocument.entries()].map(([id, projection]) => ({
      id,
      metadata: {
        documentMetadata: projection.documentMetadata,
        enrichment: {
          keywords: projection.keywords,
          entities: projection.entities
        },
        tags: projection.tags
      }
    }))
  }

  /**
   * Resolves document numbers through the `(notebook_id, field,
   * value_normalized)` projection before planning. Full numbers use an exact
   * indexed predicate. For the supported shorthand (`15/NĐ-CP`), we only
   * scan document-number rows in the notebook, then check the compact form.
   */
  findDocumentIdsByNumber(notebookId: string, documentNumber: string): string[] {
    const sqlite = getSqlite()
    if (!sqlite) return []

    const normalized = normalizeMetadataValue(documentNumber)
    const exactRows = sqlite
      .prepare(
        `SELECT document_id FROM document_metadata_values
         WHERE notebook_id = ? AND field = 'documentNumber' AND value_normalized = ?`
      )
      .all(notebookId, normalized) as Array<{ document_id: string }>
    if (exactRows.length) return exactRows.map((row) => row.document_id)

    const hasYear = /^\d{1,4}\s*\/\s*\d{4}\s*\//.test(documentNumber)
    if (hasYear) return []

    const rows = sqlite
      .prepare(
        `SELECT document_id, value_normalized FROM document_metadata_values
         WHERE notebook_id = ? AND field = 'documentNumber'`
      )
      .all(notebookId) as Array<{ document_id: string; value_normalized: string }>
    return rows
      .filter(
        (row) => row.value_normalized.replace(/^(\d{1,4})\d{4}(?=[A-Z])/, '$1') === normalized
      )
      .map((row) => row.document_id)
  }

  sync(document: {
    id: string
    notebookId: string
    metadata: Record<string, unknown> | null | undefined
  }): void {
    const sqlite = getSqlite()
    if (!sqlite) return
    const root = document.metadata ?? {}
    const legal = root.documentMetadata
    const values =
      legal && typeof legal === 'object' && !Array.isArray(legal)
        ? (legal as Record<string, unknown>)
        : {}
    const replace = sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM document_metadata_values WHERE document_id = ?').run(document.id)
      const insert = sqlite.prepare(
        `INSERT INTO document_metadata_values
          (document_id, notebook_id, field, value_normalized, value_display, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      for (const field of INDEXED_FIELDS) {
        const value = values[field]
        if (typeof value !== 'string' || !value.trim()) continue
        insert.run(
          document.id,
          document.notebookId,
          field,
          normalizeMetadataValue(value),
          value.trim(),
          'extractor',
          Date.now()
        )
      }
      const enrichment = root.enrichment
      if (enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)) {
        for (const field of ['keywords', 'entities'] as const) {
          const entries = (enrichment as Record<string, unknown>)[field]
          if (!Array.isArray(entries)) continue
          for (const value of entries) {
            if (typeof value !== 'string' || !value.trim()) continue
            insert.run(
              document.id,
              document.notebookId,
              field,
              normalizeMetadataValue(value),
              value.trim(),
              'enrichment',
              Date.now()
            )
          }
        }
      }
      const tags = root.tags
      if (Array.isArray(tags)) {
        for (const value of tags) {
          if (typeof value !== 'string' || !value.trim()) continue
          insert.run(
            document.id,
            document.notebookId,
            'tags',
            normalizeMetadataValue(value),
            value.trim(),
            'user',
            Date.now()
          )
        }
      }
    })
    replace()
  }
}
