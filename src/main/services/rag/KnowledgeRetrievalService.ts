/**
 * Retrieval pipeline for the knowledge base.
 *
 * Owns query analysis, metadata scoping, hierarchical document/section
 * selection, hybrid vector + FTS fusion, memory/lifecycle/feedback weighting,
 * reranking and context assembly. The facade only delegates here.
 */

import { and, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { getDatabase, getSqlite } from '../../db'
import {
  chunks,
  chunkFeedback,
  documents,
  knowledgeLinks,
  sections,
  type Chunk
} from '../../db/schema'
import { documentVectorStore, sectionVectorStore, vectorStoreManager } from '../../vectorstore'
import type { EmbeddingService } from '../EmbeddingService'
import type { RerankService } from '../RerankService'
import type { DocumentMetadataIndexService } from '../DocumentMetadataIndexService'
import type { KnowledgeEmbeddingRuntime } from './KnowledgeEmbeddingRuntime'
import type { SearchOptions, SearchResult } from './KnowledgeServiceTypes'
import type { MetadataAwareSearchResult, RetrievalTrace } from '../../../shared/types/retrieval'
import { detectQueryMetadata } from '../../utils/queryMetadata'
import { extractLegalMetadata } from './DocumentRetrievalMetadata'
import { selectLegalMetadataFilter } from './LegalMetadataFilter'
import {
  createRetrievalPlan,
  mergePreferredAndBroadResults,
  type ExplicitRetrievalScope
} from '../RetrievalPlanner'
import { extractDefinitionTerm, mergeOverlappingChunks, namesSpecificLaw } from './legalContext'
import Logger from '../../../shared/utils/logger'

/** Maximum section-expansion chunks (small-to-big) so context stays bounded. */
const MAX_SECTION_CONTEXT_CHUNKS = 12

/** Maximum chunk ids in an SQL IN clause (avoids the parameter limit). */
const MAX_PARAMETERIZED_CHUNK_FILTER = 5000

/** Batch size when filtering FTS by a very large chunk-id list. */
const FTS_FILTER_BATCH_SIZE = 900

interface FtsMatchRow {
  chunk_id: string
  rank: number
}

interface PageOffset {
  pageNumber?: number
  startOffset?: number
  endOffset?: number
}

interface PageStructure {
  type?: string
  pages?: PageOffset[]
}

export interface KnowledgeRetrievalServiceDeps {
  embeddingService: EmbeddingService
  embeddingRuntime: KnowledgeEmbeddingRuntime
  rerankService: RerankService
  metadataIndexService: DocumentMetadataIndexService
}

/**
 * Build the FTS5 MATCH expression.
 *
 * The old version used `"whole sentence" OR whole sentence`: FTS5 treats the
 * second branch as AND of all terms, so multi-word queries almost never
 * matched. Split into terms and OR them — BM25 still ranks by matched terms
 * and term rarity.
 */
export function buildFtsMatchQuery(query: string): string {
  const safe = query.replace(/["'*()]/g, ' ').trim()
  if (!safe) return ''

  const terms = safe.split(/\s+/).filter((term) => term.length >= 2)
  if (terms.length === 0) return ''
  if (terms.length === 1) return `"${terms[0]}"`

  return terms.map((term) => `"${term}"`).join(' OR ')
}

/**
 * Memory decay: 30-day half-life. Older memories carry less weight during
 * search.
 */
export function computeMemoryDecay(updatedAt: Date | null, now: Date = new Date()): number {
  if (!updatedAt) return 1
  const ageDays = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays <= 0) return 1
  return Math.pow(0.5, ageDays / 30)
}

const LEGAL_STOPWORDS = new Set([
  'la',
  'gi',
  'cua',
  'va',
  'cac',
  'nhung',
  'theo',
  'trong',
  'de',
  'voi',
  'cho',
  'khi',
  'tu',
  'den',
  'co',
  'duoc',
  'mot',
  'nay',
  'do',
  'nao',
  'bao',
  'lau',
  'hoi',
  'dieu',
  'luat',
  'so',
  'quy',
  'dinh',
  've',
  'tai',
  'thi',
  'bi',
  'nhu',
  'the'
])

function normalizeLegalText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeLegalText(value: string): string[] {
  return normalizeLegalText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !LEGAL_STOPWORDS.has(token))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasOffsets<T extends { startOffset: number | null; endOffset: number | null }>(
  row: T
): row is T & { startOffset: number; endOffset: number } {
  return typeof row.startOffset === 'number' && typeof row.endOffset === 'number'
}

/** "07_2022_QH15_luật sở hữu trí tuệ.pdf" -> "luat so huu tri tue". */
function lawNameKey(title: string): string {
  const normalized = normalizeLegalText(title)
  const hasBoLuat = /\bbo\s+luat\b/.test(normalized)
  const subject = normalized
    .replace(/\b(?:pdf|docx|bo|luat|qh\d*|\d+)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${hasBoLuat ? 'bo luat' : 'luat'} ${subject}`.replace(/\s+/g, ' ').trim()
}

function documentNumberKey(metadata: Record<string, unknown> | null | undefined): string | null {
  const documentMetadata = metadata?.documentMetadata as Record<string, unknown> | undefined
  const number = documentMetadata?.documentNumber ?? metadata?.documentNumber
  if (typeof number !== 'string' || !number.trim()) return null
  return normalizeLegalText(number)
}

function acronymForTitle(title: string): string {
  const subject = lawNameKey(title)
    .replace(/^(?:bo\s+)?luat\s+/, '')
    .split(' ')
    .filter(Boolean)
  if (subject.length < 2) return ''
  return subject.map((word) => word[0]).join('')
}

function queryMatchesDocument(
  queryNorm: string,
  title: string,
  metadata?: Record<string, unknown> | null
): boolean {
  const key = lawNameKey(title)
  if (key.length >= 10 && queryNorm.includes(key)) return true

  // "Bộ luật Dân sự" can be written as "luật Dân sự" in the query.
  if (key.startsWith('bo luat ')) {
    const withoutBo = key.replace(/^bo /, '')
    if (queryNorm.includes(withoutBo)) return true
  }

  const number = documentNumberKey(metadata)
  if (number && new RegExp(`\\b${escapeRegExp(number)}\\b`, 'u').test(queryNorm)) return true

  // Common abbreviation, e.g. "Luật SHTT" for "luật sở hữu trí tuệ".
  const acronym = acronymForTitle(title)
  if (acronym.length >= 2 && new RegExp(`\\b${acronym}\\b`, 'u').test(queryNorm)) return true

  return false
}

export class KnowledgeRetrievalService {
  constructor(private readonly deps: KnowledgeRetrievalServiceDeps) {}

  /**
   * Metadata-aware orchestration. Explicit scope and a uniquely identified
   * document are hard constraints; all other inferred metadata gets a
   * preferred pass followed by a broad pass, preserving recall.
   */
  async searchMetadataAware(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<MetadataAwareSearchResult<SearchResult>> {
    const startedAt = Date.now()
    const explicitScope = options.metadataFilter
    const detectedMetadata = detectQueryMetadata(query)
    // A document number is the only inferred signal permitted to become a
    // hard scope. Resolve it directly through the relational index first so a
    // large corpus does not need to be projected merely to find one document.
    const directDocumentIds = detectedMetadata.documentNumber
      ? this.deps.metadataIndexService.findDocumentIdsByNumber(
          notebookId,
          detectedMetadata.documentNumber
        )
      : []
    const corpus = this.deps.metadataIndexService.listForPlanning(
      notebookId,
      directDocumentIds.length === 1 ? directDocumentIds : undefined
    )
    const plan = createRetrievalPlan(
      query,
      corpus,
      explicitScope as ExplicitRetrievalScope | undefined
    )
    const inferredHard = plan.hardConstraints.find(
      (constraint) => constraint.source === 'query-resolver'
    )
    const hardScope: SearchOptions['metadataFilter'] | undefined = inferredHard
      ? { ...explicitScope, documentIds: plan.preferredDocumentIds }
      : explicitScope

    const passes: RetrievalTrace['passes'] = []
    const run = async (
      name: 'preferred' | 'broad',
      metadataFilter: SearchOptions['metadataFilter'],
      documentIds?: string[]
    ): Promise<SearchResult[]> => {
      const passStartedAt = Date.now()
      const result = await this.search(notebookId, query, { ...options, metadataFilter })
      passes.push({
        name,
        documentIds: documentIds?.length,
        returned: result.length,
        elapsedMs: Date.now() - passStartedAt
      })
      return result
    }

    // A unique document number is exact enough to honour as a hard scope.
    if (inferredHard) {
      const results = await run('preferred', hardScope, plan.preferredDocumentIds)
      return {
        results,
        trace: { version: 1, plan, passes, fallbackUsed: false, returned: results.length }
      }
    }

    const preferredIds = plan.preferredDocumentIds
    let preferredResults: SearchResult[] = []
    if (preferredIds.length) {
      const explicitIds = hardScope?.documentIds
      const ids = explicitIds ? preferredIds.filter((id) => explicitIds.includes(id)) : preferredIds
      if (ids.length) {
        preferredResults = await run('preferred', { ...hardScope, documentIds: ids }, ids)
      }
    }

    // Inferred type/issuer signals are never allowed to suppress semantic
    // evidence. Always execute the broad pass, then use the preferred pass as
    // a bounded ranking hint within that broad candidate set.
    const broadResults = await run('broad', hardScope)
    const fallbackUsed = preferredIds.length > 0
    const results = mergePreferredAndBroadResults(preferredResults, broadResults, options.topK ?? 5)

    const trace: RetrievalTrace = {
      version: 1,
      plan,
      passes,
      fallbackUsed,
      returned: results.length
    }
    Logger.debug(
      'KnowledgeService',
      `Metadata-aware retrieval completed in ${Date.now() - startedAt}ms`,
      trace
    )
    return { results, trace }
  }

  /**
   * Retrieve chunks scoped to articles explicitly named in the question.
   *
   * A large amended article can span many chunks (for example 112a in the
   * 2022 IP law). Global semantic/FTS ranking often returns a neighbouring
   * chunk from the same article but misses the clause that actually answers
   * the question (a time limit, an effective date, etc.). Rank chunks inside
   * the requested article by query-term overlap instead.
   */
  searchArticleChunks(
    notebookId: string,
    articleRefs: string[],
    query: string,
    limit = 4
  ): SearchResult[] {
    if (articleRefs.length === 0 || !query.trim()) return []

    const db = getDatabase()
    const queryNorm = normalizeLegalText(query)
    const wanted = articleRefs.map((ref) => `dieu ${normalizeLegalText(ref)}`)
    const sectionRows = db
      .select({
        id: sections.id,
        documentId: sections.documentId,
        headingPath: sections.headingPath,
        title: sections.title,
        startOffset: sections.startOffset,
        endOffset: sections.endOffset,
        documentTitle: documents.title,
        documentType: documents.type,
        sourceUri: documents.sourceUri,
        documentMetadata: documents.metadata
      })
      .from(sections)
      .innerJoin(documents, eq(sections.documentId, documents.id))
      .where(eq(sections.notebookId, notebookId))
      .all()

    const scopedDocumentIds = new Set(
      sectionRows
        .filter((section) =>
          queryMatchesDocument(
            queryNorm,
            section.documentTitle,
            (section.documentMetadata as Record<string, unknown> | null) || undefined
          )
        )
        .map((section) => section.documentId)
    )
    const scopedSections =
      scopedDocumentIds.size > 0
        ? sectionRows.filter((section) => scopedDocumentIds.has(section.documentId))
        : sectionRows

    const matchingSections = scopedSections.filter((section) => {
      const title = normalizeLegalText(section.title)
      return wanted.some((prefix) => new RegExp(`^${escapeRegExp(prefix)}(?![0-9a-z])`).test(title))
    })
    if (matchingSections.length === 0) return []

    const queryTokens = tokenizeLegalText(query)
    if (queryTokens.length === 0) return []

    const candidates: Array<{ result: SearchResult; lexical: number }> = []
    for (const section of matchingSections) {
      // Use offset overlap rather than only section_id: the chunk containing
      // the article heading can be assigned to the preceding section when
      // chunk boundaries cross the heading.
      let chunkRows = db
        .select({
          id: chunks.id,
          content: chunks.content,
          metadata: chunks.metadata,
          chunkIndex: chunks.chunkIndex,
          startOffset: chunks.startOffset,
          endOffset: chunks.endOffset
        })
        .from(chunks)
        .where(
          and(
            eq(chunks.documentId, section.documentId),
            lt(chunks.startOffset, section.endOffset),
            gt(chunks.endOffset, section.startOffset)
          )
        )
        .all()

      if (chunkRows.length === 0) {
        chunkRows = db
          .select({
            id: chunks.id,
            content: chunks.content,
            metadata: chunks.metadata,
            chunkIndex: chunks.chunkIndex,
            startOffset: chunks.startOffset,
            endOffset: chunks.endOffset
          })
          .from(chunks)
          .where(eq(chunks.sectionId, section.id))
          .all()
      }

      for (const chunk of chunkRows) {
        const normalized = normalizeLegalText(chunk.content)
        const lexical = this.lexicalOverlap(queryTokens, new Set(tokenizeLegalText(chunk.content)))
        const phraseBoost = /thoi han|hieu luc|dinh nghia|bao lau|thoi diem/.test(normalized)
          ? 2
          : 0
        if (lexical + phraseBoost <= 0) continue

        candidates.push({
          lexical: lexical + phraseBoost,
          result: {
            chunkId: chunk.id,
            documentId: section.documentId,
            documentTitle: section.documentTitle,
            documentType: section.documentType,
            sourceUri: section.sourceUri || undefined,
            pageNumber: this.resolveChunkPageNumber(
              (section.documentMetadata as Record<string, unknown> | null) || undefined,
              (chunk.metadata as Record<string, unknown> | null) || undefined,
              chunk.startOffset,
              chunk.endOffset
            ),
            sectionPath:
              Array.isArray(section.headingPath) && section.headingPath.length > 0
                ? section.headingPath
                : [section.title],
            content: chunk.content,
            matchedContent: chunk.content,
            score: 0,
            chunkIndex: chunk.chunkIndex,
            metadata: (chunk.metadata as Record<string, unknown> | null) || undefined
          }
        })
      }
    }

    const ranked = candidates.sort((left, right) => right.lexical - left.lexical)

    // Legal enumerations are often split across adjacent chunks (for example
    // "a) Chín tháng..." then "b) Bốn tháng... c) Năm tháng..."). The
    // successor often has no lexical overlap with the question, so fetch it
    // directly and attach it to the top candidates.
    const selected = ranked.slice(0, Math.max(1, limit)).map((candidate, index) => {
      if (index >= 2) return candidate
      const next = db
        .select({
          content: chunks.content,
          metadata: chunks.metadata,
          startOffset: chunks.startOffset,
          endOffset: chunks.endOffset
        })
        .from(chunks)
        .where(
          and(
            eq(chunks.documentId, candidate.result.documentId),
            eq(chunks.chunkIndex, candidate.result.chunkIndex + 1)
          )
        )
        .get()
      if (!next) return candidate

      // Do not leak a next-page clause into a page-scoped result.
      if (typeof candidate.result.pageNumber === 'number') {
        const nextPage = this.resolveChunkPageNumber(
          undefined,
          (next.metadata as Record<string, unknown> | null) || undefined,
          next.startOffset,
          next.endOffset
        )
        if (typeof nextPage === 'number' && nextPage !== candidate.result.pageNumber) {
          return candidate
        }
      }

      return {
        ...candidate,
        result: {
          ...candidate.result,
          content: `${candidate.result.content}\n${next.content}`
        }
      }
    })

    const seen = new Set<string>()
    return selected
      .filter((candidate) => {
        if (seen.has(candidate.result.chunkId)) return false
        seen.add(candidate.result.chunkId)
        return true
      })
      .map((candidate, index) => ({
        ...candidate.result,
        // Article-scoped chunks must survive the later score-based merge.
        score: 1 - index * 0.01
      }))
  }

  /**
   * Return one complete, source-ordered block for each requested article.
   *
   * List questions need the whole article, not the best-ranked five chunks:
   * a long enumeration can span ten chunks and the last chunk often contains
   * the clause that completes the final item. Chunks are merged by source
   * offset so overlapping text is not repeated in the prompt.
   */
  getArticleContext(
    notebookId: string,
    articleRefs: string[],
    options: {
      query?: string
      documentIds?: string[]
      maxArticles?: number
      maxChars?: number
    } = {}
  ): SearchResult[] {
    if (articleRefs.length === 0) return []

    const db = getDatabase()
    const wanted = articleRefs.map((ref) => `dieu ${normalizeLegalText(ref)}`)
    const documentFilter = new Set(options.documentIds ?? [])
    const maxArticles = Math.min(Math.max(options.maxArticles ?? 2, 1), 8)
    const maxChars = Math.min(Math.max(options.maxChars ?? 12_000, 500), 24_000)

    const sectionRows = db
      .select({
        id: sections.id,
        documentId: sections.documentId,
        headingPath: sections.headingPath,
        title: sections.title,
        startOffset: sections.startOffset,
        endOffset: sections.endOffset,
        documentTitle: documents.title,
        documentType: documents.type,
        sourceUri: documents.sourceUri,
        documentMetadata: documents.metadata
      })
      .from(sections)
      .innerJoin(documents, eq(sections.documentId, documents.id))
      .where(eq(sections.notebookId, notebookId))
      .all()

    const queryNorm = options.query ? normalizeLegalText(options.query) : ''
    const namesLaw = options.query ? namesSpecificLaw(options.query) : false
    const lawScoped =
      namesLaw && queryNorm
        ? sectionRows.filter((section) =>
            queryMatchesDocument(
              queryNorm,
              section.documentTitle,
              (section.documentMetadata as Record<string, unknown> | null) || undefined
            )
          )
        : []
    // If the user names a specific law that is not in the notebook, do not
    // fall back to the first article with the same number from another law.
    // Generic phrases such as "luật này" still use the seed document.
    if (namesLaw && lawScoped.length === 0) return []
    // Narrow the pool only when the question really names a law. A loose
    // number or acronym hit on a generic question must not scope the pool
    // away from the document the seed already selected.
    const pool = lawScoped.length > 0 ? lawScoped : sectionRows

    const wantedPatterns = wanted.map(
      (prefix) => new RegExp(`^${escapeRegExp(prefix)}(?![0-9a-z])`, 'u')
    )
    const matchingSections = pool
      .filter((section) => {
        if (documentFilter.size > 0 && !documentFilter.has(section.documentId)) return false
        const title = normalizeLegalText(section.title)
        return wantedPatterns.some((pattern) => pattern.test(title))
      })
      .slice(0, maxArticles)

    const blocks: SearchResult[] = []
    for (const section of matchingSections) {
      let chunkRows = db
        .select({
          id: chunks.id,
          content: chunks.content,
          metadata: chunks.metadata,
          chunkIndex: chunks.chunkIndex,
          startOffset: chunks.startOffset,
          endOffset: chunks.endOffset
        })
        .from(chunks)
        .where(
          and(
            eq(chunks.documentId, section.documentId),
            lt(chunks.startOffset, section.endOffset),
            gt(chunks.endOffset, section.startOffset)
          )
        )
        .all()

      if (chunkRows.length === 0) {
        chunkRows = db
          .select({
            id: chunks.id,
            content: chunks.content,
            metadata: chunks.metadata,
            chunkIndex: chunks.chunkIndex,
            startOffset: chunks.startOffset,
            endOffset: chunks.endOffset
          })
          .from(chunks)
          .where(eq(chunks.sectionId, section.id))
          .all()
      }

      if (chunkRows.length === 0) continue

      const ordered = chunkRows
        .filter(hasOffsets)
        .sort((left, right) => left.startOffset - right.startOffset)
      if (ordered.length === 0) continue
      const merged = mergeOverlappingChunks(ordered)
      if (!merged.trim()) continue
      const matchedContent =
        merged.length > 6000 && options.query
          ? this.selectRelevantWindow(merged, options.query, Math.min(maxChars, 4000))
          : merged

      const first = ordered[0]
      blocks.push({
        chunkId: first.id,
        documentId: section.documentId,
        documentTitle: section.documentTitle,
        documentType: section.documentType,
        sourceUri: section.sourceUri || undefined,
        pageNumber: this.resolveChunkPageNumber(
          (section.documentMetadata as Record<string, unknown> | null) || undefined,
          (first.metadata as Record<string, unknown> | null) || undefined,
          first.startOffset,
          first.endOffset
        ),
        sectionPath:
          Array.isArray(section.headingPath) && section.headingPath.length > 0
            ? section.headingPath
            : [section.title],
        content: merged,
        matchedContent,
        score: 2 - blocks.length * 0.01,
        chunkIndex: first.chunkIndex,
        metadata: (first.metadata as Record<string, unknown> | null) || undefined
      })
    }

    return blocks
  }

  /**
   * Find the exact defining clause for a "X là gì / định nghĩa X" question.
   *
   * Semantic search often returns the chunk *after* the definition because the
   * definition starts near a chunk boundary (for example clause 6 of Điều 3
   * ends in the next chunk). This scan anchors on the definition phrase
   * itself, then merges the following chunks without overlap.
   */
  searchDefinitionEvidence(
    notebookId: string,
    query: string,
    limit = 2,
    documentIds?: string[]
  ): SearchResult[] {
    const term = extractDefinitionTerm(query)
    if (!term) return []
    const termNorm = normalizeLegalText(term)
    if (termNorm.length < 3) return []

    const db = getDatabase()
    const documentRows = db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        sourceUri: documents.sourceUri,
        metadata: documents.metadata
      })
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .all()
    if (documentRows.length === 0) return []

    const queryNorm = normalizeLegalText(query)
    const allowedDocuments = documentIds?.length ? new Set(documentIds) : null
    const mentioned = documentRows.filter(
      (document) =>
        (!allowedDocuments || allowedDocuments.has(document.id)) &&
        queryMatchesDocument(
          queryNorm,
          document.title,
          (document.metadata as Record<string, unknown> | null) || undefined
        )
    )
    if (namesSpecificLaw(query) && mentioned.length === 0 && !allowedDocuments) return []
    const scopedDocuments = (mentioned.length > 0 ? mentioned : documentRows).filter(
      (document) => !allowedDocuments || allowedDocuments.has(document.id)
    )
    if (scopedDocuments.length === 0) return []
    const documentMap = new Map(scopedDocuments.map((document) => [document.id, document]))
    const scopedIds = scopedDocuments.map((document) => document.id)

    const rows = db
      .select({
        id: chunks.id,
        documentId: chunks.documentId,
        content: chunks.content,
        metadata: chunks.metadata,
        chunkIndex: chunks.chunkIndex,
        startOffset: chunks.startOffset,
        endOffset: chunks.endOffset
      })
      .from(chunks)
      .where(inArray(chunks.documentId, scopedIds))
      .all()

    const termPattern = new RegExp(
      term
        .split(/\s+/u)
        .map((part) => escapeRegExp(part))
        .join('\\s+'),
      'iu'
    )
    const termPatternGlobal = new RegExp(termPattern.source, 'giu')
    const copulaNorm = [
      `${termNorm} la `,
      `${termNorm} duoc hieu la `,
      `${termNorm} duoc dinh nghia la `
    ]
    const candidates: Array<{
      row: (typeof rows)[number] & { startOffset: number; endOffset: number }
      matchIndex: number
      score: number
    }> = []

    for (const row of rows) {
      if (!hasOffsets(row)) continue
      const normalized = normalizeLegalText(row.content)
      if (!copulaNorm.some((phrase) => normalized.includes(phrase))) continue

      const matches = [...row.content.matchAll(termPatternGlobal)]
      const match = matches.find((candidate) => {
        const after = row.content.slice(candidate.index, candidate.index + term.length + 80)
        return /(?:là|được hiểu là|được định nghĩa là)\s+/iu.test(after)
      })
      if (!match || match.index === undefined) continue

      const metadata = (row.metadata as Record<string, unknown> | null) || undefined
      const sectionTitle = normalizeLegalText(
        typeof metadata?.sectionTitle === 'string'
          ? metadata.sectionTitle
          : Array.isArray(metadata?.headingPath)
            ? (metadata.headingPath as string[]).slice(-1)[0] || ''
            : ''
      )
      const clauseStart = row.content.slice(Math.max(0, match.index - 12), match.index)
      let score = 2.5
      if (sectionTitle.includes('giai thich tu ngu') || sectionTitle.includes('dinh nghia')) {
        score += 0.5
      }
      if (/\d+\.\s*$/u.test(clauseStart)) score += 0.2
      candidates.push({ row, matchIndex: match.index, score })
    }

    candidates.sort(
      (left, right) => right.score - left.score || left.row.chunkIndex - right.row.chunkIndex
    )

    return candidates.slice(0, Math.max(1, limit)).map((candidate, index) => {
      const { row, matchIndex } = candidate
      const document = documentMap.get(row.documentId)
      const metadata = (row.metadata as Record<string, unknown> | null) || undefined
      const nextRows = db
        .select({
          content: chunks.content,
          startOffset: chunks.startOffset,
          endOffset: chunks.endOffset
        })
        .from(chunks)
        .where(
          and(
            eq(chunks.documentId, row.documentId),
            inArray(
              chunks.chunkIndex,
              Array.from({ length: 6 }, (_, offset) => row.chunkIndex + offset + 1)
            )
          )
        )
        .all()

      // Include the numbered clause label ("6. ") in front of the term so the
      // model can quote the definition with its source numbering intact.
      const labelLookback = row.content.slice(Math.max(0, matchIndex - 16), matchIndex)
      const labelMatch = /(?:^|\n)\s*\d+\.\s*$/.exec(labelLookback)
      const contentStart = labelMatch
        ? matchIndex - (labelLookback.length - labelMatch.index)
        : matchIndex
      const merged = mergeOverlappingChunks([
        {
          content: row.content.slice(contentStart),
          startOffset: row.startOffset + contentStart,
          endOffset: row.endOffset
        },
        ...nextRows.filter(hasOffsets)
      ]).slice(0, 2400)
      // Stop at the next numbered clause so the definition block does not
      // carry the following definition into the prompt. Searching after the
      // first character skips the clause label that was just included, which
      // would otherwise match its own boundary.
      const nextClauseIndex = merged.slice(1).search(/\n{1,2}\d+\.\s/u)
      const nextClause = nextClauseIndex < 0 ? -1 : nextClauseIndex + 1
      const content = nextClause > 80 ? merged.slice(0, nextClause) : merged

      const headingPath = Array.isArray(metadata?.headingPath)
        ? (metadata.headingPath as string[])
        : undefined

      return {
        chunkId: row.id,
        documentId: row.documentId,
        documentTitle: document?.title || '',
        documentType: document?.type || 'file',
        sourceUri: document?.sourceUri || undefined,
        pageNumber: this.resolveChunkPageNumber(
          (document?.metadata as Record<string, unknown> | null) || undefined,
          metadata,
          row.startOffset,
          row.endOffset
        ),
        sectionPath: headingPath,
        content,
        matchedContent: content,
        score: 3 - index * 0.01,
        chunkIndex: row.chunkIndex,
        metadata
      }
    })
  }

  /**
   * Pull the exact clause that answers a date/time-limit question out of the
   * scoped documents. This is deliberately narrow: it only runs for "hiệu lực"
   * or "thời hạn/bao lâu" questions and only returns clauses matching those
   * patterns. It prevents a neighbouring clause from being the only context.
   */
  searchDirectEvidence(
    notebookId: string,
    query: string,
    limit = 4,
    documentIds?: string[]
  ): SearchResult[] {
    const wantsEffectiveDate = /hiệu lực/i.test(query)
    const wantsDuration = /(thời hạn|bao lâu)/i.test(query)
    if (!wantsEffectiveDate && !wantsDuration) return []

    const db = getDatabase()
    const documentRows = db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        sourceUri: documents.sourceUri,
        metadata: documents.metadata
      })
      .from(documents)
      .where(eq(documents.notebookId, notebookId))
      .all()
    if (documentRows.length === 0) return []

    const queryNorm = normalizeLegalText(query)
    // Require an explicit "luật <subject>" mention. A query containing
    // "dữ liệu thử nghiệm" must not pull in the Data Law when it actually
    // names the IP Law.
    const allowedDocuments = documentIds?.length ? new Set(documentIds) : null
    const mentioned = documentRows.filter(
      (document) =>
        (!allowedDocuments || allowedDocuments.has(document.id)) &&
        queryMatchesDocument(
          queryNorm,
          document.title,
          (document.metadata as Record<string, unknown> | null) || undefined
        )
    )
    if (namesSpecificLaw(query) && mentioned.length === 0 && !allowedDocuments) return []
    const scopedDocuments = (mentioned.length > 0 ? mentioned : documentRows).filter(
      (document) => !allowedDocuments || allowedDocuments.has(document.id)
    )
    if (scopedDocuments.length === 0) return []
    const scopedIds = scopedDocuments.map((document) => document.id)
    const documentMap = new Map(scopedDocuments.map((document) => [document.id, document]))

    const entityPhrases = [
      'nhan hieu',
      'sang che',
      'kieu dang cong nghiep',
      'chi dan dia ly',
      'giong cay trong',
      'du lieu',
      'an ninh mang'
    ].filter((phrase) => queryNorm.includes(phrase))

    const rows = db
      .select({
        id: chunks.id,
        documentId: chunks.documentId,
        content: chunks.content,
        metadata: chunks.metadata,
        chunkIndex: chunks.chunkIndex,
        startOffset: chunks.startOffset,
        endOffset: chunks.endOffset
      })
      .from(chunks)
      .where(inArray(chunks.documentId, scopedIds))
      .all()

    const queryTokens = tokenizeLegalText(query)
    const results: Array<{ result: SearchResult; score: number }> = []
    const seen = new Set<string>()

    for (const row of rows) {
      if (seen.has(row.id)) continue
      const lines = row.content
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)

      const evidenceLines = lines.filter((line) => {
        const normalized = normalizeLegalText(line)
        if (wantsEffectiveDate) {
          return /có hiệu lực(?: thi hành)? từ ngày/i.test(line)
        }
        if (!wantsDuration || !/(tháng|năm)/i.test(line)) return false
        if (entityPhrases.length === 0) return true
        return entityPhrases.some((phrase) => normalized.includes(phrase))
      })

      if (evidenceLines.length === 0) continue
      const document = documentMap.get(row.documentId)
      if (!document) continue

      const metadata = (row.metadata as Record<string, unknown> | null) || undefined
      const headingPath = Array.isArray(metadata?.headingPath)
        ? (metadata?.headingPath as string[])
        : undefined
      const lexical = this.lexicalOverlap(queryTokens, new Set(tokenizeLegalText(row.content)))
      const mainClauseBoost =
        wantsEffectiveDate && /1\.\s*Luật này có hiệu lực/i.test(row.content) ? 0.5 : 0

      seen.add(row.id)
      results.push({
        score: lexical + mainClauseBoost,
        result: {
          chunkId: row.id,
          documentId: row.documentId,
          documentTitle: document.title,
          documentType: document.type,
          sourceUri: document.sourceUri || undefined,
          pageNumber: this.resolveChunkPageNumber(
            (document.metadata as Record<string, unknown> | null) || undefined,
            (row.metadata as Record<string, unknown> | null) || undefined,
            row.startOffset,
            row.endOffset
          ),
          sectionPath: headingPath,
          content: row.content,
          matchedContent: row.content,
          score: 0,
          chunkIndex: row.chunkIndex,
          metadata
        }
      })
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, limit))
      .map((entry, index) => ({
        ...entry.result,
        // Direct evidence must be merged ahead of normal semantic hits.
        score: 2 - index * 0.01
      }))
  }

  /**
   * Pick a query-relevant window from a very long article. The window becomes
   * `matchedContent`, so the prompt clipper centres on the clause that answers
   * the question instead of always taking the first N characters.
   */
  private selectRelevantWindow(content: string, query: string, maxChars: number): string {
    const queryTokens = tokenizeLegalText(query)
    if (queryTokens.length === 0) return content.slice(0, maxChars)

    const paragraphs = content.split(/\n{2,}/u).filter((paragraph) => paragraph.trim())
    if (paragraphs.length <= 1) return content.slice(0, maxChars)

    let bestIndex = 0
    let bestScore = -1
    for (let index = 0; index < paragraphs.length; index += 1) {
      const normalized = normalizeLegalText(paragraphs[index])
      const lexical = this.lexicalOverlap(
        queryTokens,
        new Set(tokenizeLegalText(paragraphs[index]))
      )
      const phraseBoost = /thoi han|hieu luc|dinh nghia|bao lau|ngay/.test(normalized) ? 0.15 : 0
      const score = lexical + phraseBoost
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    let start = bestIndex
    let end = bestIndex + 1
    let total = paragraphs[start].length

    // Keep the window tight (the matching clause plus at most four
    // neighbours). Expanding until the character budget is full would drag
    // unrelated filler from the beginning/end of a long article back in.
    while ((start > 0 || end < paragraphs.length) && end - start < 5) {
      const previousLength = start > 0 ? paragraphs[start - 1].length : Number.POSITIVE_INFINITY
      const nextLength = end < paragraphs.length ? paragraphs[end].length : Number.POSITIVE_INFINITY
      if (Math.min(previousLength, nextLength) === Number.POSITIVE_INFINITY) break
      if (total + Math.min(previousLength, nextLength) > maxChars) break
      if (previousLength <= nextLength && start > 0) {
        start -= 1
        total += previousLength
      } else if (end < paragraphs.length) {
        total += nextLength
        end += 1
      } else {
        break
      }
    }

    return paragraphs.slice(start, end).join('\n\n').slice(0, maxChars)
  }

  private lexicalOverlap(queryTokens: string[], documentTokens: Set<string>): number {
    if (queryTokens.length === 0) return 0
    let hits = 0
    for (const token of queryTokens) {
      if (documentTokens.has(token)) hits++
    }
    return hits / queryTokens.length
  }

  async search(
    notebookId: string,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    // Do not probe dimensions with a separate embedding request here: the
    // query embedding below is validated instead. A probe added one full
    // embedding round-trip to the first search after every app start.
    await this.deps.embeddingRuntime.ensureReady()
    const startedAt = Date.now()
    const { topK = 5, threshold = 0.5, includeContent = true, metadataFilter, rerank } = options
    const rerankEnabled = rerank?.enabled ?? false
    const rerankTopN = Math.min(Math.max(rerank?.topN ?? topK * 2, 1), 100)
    const rerankHeuristicFallback = rerank?.heuristicFallback ?? true
    const retrievalCandidateLimit = Math.max(topK * 2, rerankEnabled ? rerankTopN : topK)
    const sqlite = getSqlite()

    // Document-level scope (goes straight into KNN via document_id) and
    // chunk-level scope (only needed for section/page filters).
    const scopeDocumentIds = this.resolveFilteredDocumentIds(notebookId, metadataFilter)
    if (scopeDocumentIds && scopeDocumentIds.length === 0) {
      const hasMetadataFilter =
        !!metadataFilter?.documentMetadata &&
        Object.keys(metadataFilter.documentMetadata).length > 0
      const message = 'Search returned 0 results due to metadata filter'
      if (hasMetadataFilter) Logger.warn('KnowledgeService', message)
      else Logger.debug('KnowledgeService', message)
      return []
    }

    let scopeChunkIds = this.resolveChunkLevelFilterIds(
      notebookId,
      scopeDocumentIds,
      metadataFilter
    )
    if (scopeChunkIds && scopeChunkIds.length === 0) {
      Logger.debug('KnowledgeService', 'Search returned 0 results due to section/page filter')
      return []
    }

    // 1. Vector search
    const queryEmbedding = await this.deps.embeddingService.embed(query)
    if (queryEmbedding.dimensions !== 1024) {
      throw new Error(
        `Unsupported query embedding dimensions: ${queryEmbedding.dimensions}. Current sqlite-vec schema requires 1024 dimensions.`
      )
    }

    const vectorStore = await vectorStoreManager.getStore(notebookId, undefined, 1024)

    // 1b. Document-selection tier (hierarchical retrieval). Hard scope is
    // applied first, then semantic/keyword document retrieval narrows inside.
    let hierarchicalDocumentIds: string[] = []

    if ((options.hierarchical?.enabled ?? false) && !scopeChunkIds) {
      const docTopK = Math.min(Math.max(options.hierarchical?.docTopK ?? 8, 1), 50)
      const indexedDocumentCount = this.countIndexedDocuments(
        notebookId,
        scopeDocumentIds ?? undefined
      )
      const documentVectorCount = documentVectorStore.count(
        notebookId,
        scopeDocumentIds ?? undefined
      )

      if (documentVectorCount === 0) {
        Logger.debug('KnowledgeService', 'Hierarchical stage skipped: document index is empty')
      } else if (documentVectorCount < indexedDocumentCount) {
        // The document index does not cover every document yet (e.g. old
        // documents not reindexed). Restricting to the selection would silently
        // drop documents without vectors, so fall back to flat search.
        Logger.debug(
          'KnowledgeService',
          `Hierarchical stage skipped: document index covers ${documentVectorCount}/${indexedDocumentCount} documents`
        )
      } else {
        const docMatches = documentVectorStore.query(notebookId, queryEmbedding.embedding, {
          topK: docTopK,
          threshold: options.hierarchical?.threshold,
          documentIds: scopeDocumentIds ?? undefined
        })

        // Merge keyword-matched documents (document-level BM25) to preserve
        // recall for queries the document vector does not cover.
        const hardScope = scopeDocumentIds ? new Set(scopeDocumentIds) : null
        const keywordDocumentIds = this.findKeywordDocumentIds(
          notebookId,
          query,
          docTopK * 2
        ).filter((documentId) => !hardScope || hardScope.has(documentId))
        const selectedDocumentIds = [
          ...new Set([...docMatches.map((match) => match.documentId), ...keywordDocumentIds])
        ]

        // Selecting every document means no restriction is needed (flat search).
        if (selectedDocumentIds.length > 0 && selectedDocumentIds.length < indexedDocumentCount) {
          hierarchicalDocumentIds = selectedDocumentIds
        }
      }
    }

    const effectiveDocumentIds =
      hierarchicalDocumentIds.length > 0 ? hierarchicalDocumentIds : scopeDocumentIds
    const documentFilterIds =
      effectiveDocumentIds && effectiveDocumentIds.length > 0 ? effectiveDocumentIds : undefined

    // 1c. Section-selection tier (middle tier of hierarchical retrieval).
    // Only runs when the caller enables hierarchical and no explicit
    // section/page scope exists. Skipped while the section index is incomplete.
    if ((options.hierarchical?.enabled ?? false) && !scopeChunkIds) {
      const sectionTopK = Math.min(Math.max(options.hierarchical?.sectionTopK ?? 16, 1), 100)
      const totalSections = this.countSections(notebookId, documentFilterIds)
      const sectionVectorCount = sectionVectorStore.count(notebookId, documentFilterIds)

      if (totalSections === 0) {
        Logger.debug('KnowledgeService', 'Section stage skipped: no section records')
      } else if (sectionVectorCount < totalSections) {
        Logger.debug(
          'KnowledgeService',
          `Section stage skipped: section index covers ${sectionVectorCount}/${totalSections} sections`
        )
      } else {
        const sectionMatches = sectionVectorStore.query(notebookId, queryEmbedding.embedding, {
          topK: sectionTopK,
          threshold: options.hierarchical?.threshold,
          documentIds: documentFilterIds
        })

        if (sectionMatches.length > 0) {
          const tierChunkIds = this.chunkIdsForSectionTier(
            notebookId,
            sectionMatches.map((match) => match.sectionId),
            documentFilterIds
          )
          if (tierChunkIds.length > 0) {
            scopeChunkIds = tierChunkIds
            Logger.debug(
              'KnowledgeService',
              `Section stage selected ${sectionMatches.length} sections -> ${tierChunkIds.length} chunks`
            )
          }
        }
      }
    }

    // The chunk-id list (only present for section/page filters) can be too
    // large for an SQLite IN clause → widen KNN and filter in JS.
    const filterOverflow = !!scopeChunkIds && scopeChunkIds.length > MAX_PARAMETERIZED_CHUNK_FILTER
    const overflowFilterSet = filterOverflow ? new Set(scopeChunkIds) : undefined

    if (filterOverflow) {
      Logger.warn(
        'KnowledgeService',
        `Chunk-id filter too large (${scopeChunkIds!.length}); widened KNN + JS filter`
      )
    }

    const vectorFilter =
      documentFilterIds || (scopeChunkIds && !filterOverflow)
        ? {
            documentIds: documentFilterIds,
            chunkIds: scopeChunkIds && !filterOverflow ? scopeChunkIds : undefined
          }
        : undefined

    const vectorCandidates = await vectorStore.query(queryEmbedding.embedding, {
      topK: filterOverflow ? Math.min(retrievalCandidateLimit * 40, 500) : retrievalCandidateLimit,
      threshold,
      filter: vectorFilter
    }) // Fetch more for RRF

    const vectorResults = overflowFilterSet
      ? vectorCandidates
          .filter((candidate) => overflowFilterSet.has(candidate.chunkId))
          .slice(0, retrievalCandidateLimit)
      : vectorCandidates

    // 2. FTS5 BM25 keyword search
    let ftsResults: FtsMatchRow[] = []
    if (sqlite) {
      try {
        const match = buildFtsMatchQuery(query)
        if (match) {
          const baseSql = `
            SELECT chunk_id, rank 
            FROM fts_chunks 
            WHERE notebook_id = ? AND fts_chunks MATCH ? 
          `
          const baseParams: unknown[] = [notebookId, match]

          // Filter by document through a subquery on chunks: few parameters
          // (one per selected document), unlike a chunk-id list.
          const documentClause = documentFilterIds?.length
            ? ` AND chunk_id IN (SELECT id FROM chunks WHERE notebook_id = ? AND document_id IN (${documentFilterIds
                .map(() => '?')
                .join(',')}))`
            : ''
          const documentParams: unknown[] = documentFilterIds?.length
            ? [notebookId, ...documentFilterIds]
            : []

          if (!scopeChunkIds || scopeChunkIds.length === 0) {
            ftsResults = sqlite
              .prepare(`${baseSql}${documentClause} ORDER BY rank LIMIT ?`)
              .all(...baseParams, ...documentParams, retrievalCandidateLimit) as FtsMatchRow[]
          } else if (scopeChunkIds.length <= FTS_FILTER_BATCH_SIZE) {
            const placeholders = scopeChunkIds.map(() => '?').join(',')
            ftsResults = sqlite
              .prepare(
                `${baseSql}${documentClause} AND chunk_id IN (${placeholders}) ORDER BY rank LIMIT ?`
              )
              .all(
                ...baseParams,
                ...documentParams,
                ...scopeChunkIds,
                retrievalCandidateLimit
              ) as FtsMatchRow[]
          } else {
            // The chunk-id list is too large → split into batches so the
            // parameter limit is not exceeded. BM25 rank is per-row, so scores
            // remain comparable across batches.
            const merged: FtsMatchRow[] = []

            for (let offset = 0; offset < scopeChunkIds.length; offset += FTS_FILTER_BATCH_SIZE) {
              const batch = scopeChunkIds.slice(offset, offset + FTS_FILTER_BATCH_SIZE)
              const placeholders = batch.map(() => '?').join(',')
              merged.push(
                ...(sqlite
                  .prepare(
                    `${baseSql}${documentClause} AND chunk_id IN (${placeholders}) ORDER BY rank LIMIT ?`
                  )
                  .all(
                    ...baseParams,
                    ...documentParams,
                    ...batch,
                    retrievalCandidateLimit
                  ) as FtsMatchRow[])
              )
            }

            ftsResults = merged.sort((a, b) => a.rank - b.rank).slice(0, retrievalCandidateLimit)
          }
        }
      } catch (error) {
        Logger.warn('KnowledgeService', 'FTS Search failed (likely syntax):', error)
      }
    }

    // 3. Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map<string, number>()
    const k = 60 // RRF constant

    // Add vector scores
    vectorResults.forEach((vr, index) => {
      const rank = index + 1
      rrfScores.set(vr.chunkId, 1 / (k + rank))
    })

    // Add FTS scores
    ftsResults.forEach((fr, index) => {
      const rank = index + 1
      const currentScore = rrfScores.get(fr.chunk_id) || 0
      rrfScores.set(fr.chunk_id, currentScore + 1 / (k + rank))
    })

    if (rrfScores.size === 0) return []

    let fusedRankedChunkIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1]) // highest score first
      .map(([chunkId]) => chunkId)

    const db = getDatabase()

    // 3.5 Memory decay + feedback + lifecycle weighting
    const fusedChunkRows = db
      .select({ id: chunks.id, documentId: chunks.documentId })
      .from(chunks)
      .where(inArray(chunks.id, fusedRankedChunkIds))
      .all()
    const fusedDocIds = [...new Set(fusedChunkRows.map((c) => c.documentId))]
    if (fusedDocIds.length > 0) {
      const fusedDocs = db
        .select({
          id: documents.id,
          type: documents.type,
          updatedAt: documents.updatedAt,
          metadata: documents.metadata
        })
        .from(documents)
        .where(inArray(documents.id, fusedDocIds))
        .all()

      // 3.5a Memory decay: older memories carry less weight
      const decayByDoc = new Map<string, number>()
      // 3.5b Lifecycle: outdated drops sharply, verified rises slightly
      const lifecycleWeightByDoc = new Map<string, number>()
      for (const d of fusedDocs) {
        if (d.type === 'memory') {
          decayByDoc.set(d.id, computeMemoryDecay(d.updatedAt))
        }
        const lifecycleState = (d.metadata as Record<string, unknown> | null)?.lifecycleState
        if (lifecycleState === 'outdated') lifecycleWeightByDoc.set(d.id, 0.4)
        else if (lifecycleState === 'verified') lifecycleWeightByDoc.set(d.id, 1.1)
      }

      // 3.5c Chunk feedback: user ratings of citations/corrections
      const feedbackRows = db
        .select()
        .from(chunkFeedback)
        .where(inArray(chunkFeedback.chunkId, fusedRankedChunkIds))
        .all()
      const feedbackWeightByChunk = new Map<string, number>()
      for (const fb of feedbackRows) {
        const weight = fb.kind === 'citation_good' ? 1.15 : fb.kind === 'citation_bad' ? 0.7 : 0.5
        const current = feedbackWeightByChunk.get(fb.chunkId) ?? 1
        feedbackWeightByChunk.set(fb.chunkId, current * weight)
      }

      const chunkDocMap = new Map(fusedChunkRows.map((c) => [c.id, c.documentId]))

      for (const [chunkId, score] of rrfScores) {
        let adjusted = score
        const docId = chunkDocMap.get(chunkId)
        if (docId) {
          const decay = decayByDoc.get(docId)
          if (decay !== undefined && decay < 1) adjusted *= decay
          const lifecycle = lifecycleWeightByDoc.get(docId)
          if (lifecycle !== undefined) adjusted *= lifecycle
        }
        const feedback = feedbackWeightByChunk.get(chunkId)
        if (feedback !== undefined) adjusted *= feedback
        if (adjusted !== score) rrfScores.set(chunkId, adjusted)
      }

      fusedRankedChunkIds = Array.from(rrfScores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([chunkId]) => chunkId)
    }

    // 3.6 Knowledge-link expansion: pull cross-document linked chunks
    // (knowledge graph) into the result set below their source chunk.
    const linkRows = db
      .select({
        sourceChunkId: knowledgeLinks.sourceChunkId,
        targetChunkId: knowledgeLinks.targetChunkId,
        confidence: knowledgeLinks.confidence
      })
      .from(knowledgeLinks)
      .where(and(eq(knowledgeLinks.notebookId, notebookId), eq(knowledgeLinks.status, 'active')))
      .all()

    const linkedExtra = new Map<string, number>()
    if (linkRows.length > 0) {
      // Before expanding through links, identify which linked chunks are
      // inside the current search scope (document/section/page) — links must
      // not pull results outside the scope the user selected.
      const linkedCandidateIds = new Set<string>()
      for (const link of linkRows) {
        if (!link.sourceChunkId || !link.targetChunkId) continue
        const sourceScore = rrfScores.get(link.sourceChunkId)
        const targetScore = rrfScores.get(link.targetChunkId)
        if (sourceScore !== undefined && targetScore === undefined) {
          linkedCandidateIds.add(link.targetChunkId)
        } else if (targetScore !== undefined && sourceScore === undefined) {
          linkedCandidateIds.add(link.sourceChunkId)
        }
      }

      const scopedLinkIds = new Set<string>()
      const hasScope = scopeChunkIds !== null || documentFilterIds !== undefined
      if (!hasScope) {
        for (const id of linkedCandidateIds) scopedLinkIds.add(id)
      } else if (linkedCandidateIds.size > 0) {
        const scopeChunkSet = scopeChunkIds ? new Set(scopeChunkIds) : null
        const scopeDocSet = documentFilterIds ? new Set(documentFilterIds) : null
        const candidateList = [...linkedCandidateIds]

        for (
          let offset = 0;
          offset < candidateList.length;
          offset += MAX_PARAMETERIZED_CHUNK_FILTER
        ) {
          const batch = candidateList.slice(offset, offset + MAX_PARAMETERIZED_CHUNK_FILTER)
          const rows = db
            .select({ id: chunks.id, documentId: chunks.documentId })
            .from(chunks)
            .where(inArray(chunks.id, batch))
            .all()
          for (const row of rows) {
            if (scopeChunkSet) {
              if (scopeChunkSet.has(row.id)) scopedLinkIds.add(row.id)
            } else if (scopeDocSet?.has(row.documentId)) {
              scopedLinkIds.add(row.id)
            }
          }
        }
      }

      for (const link of linkRows) {
        if (!link.sourceChunkId || !link.targetChunkId) continue
        const confidence = link.confidence ?? 0.5
        const sourceScore = rrfScores.get(link.sourceChunkId)
        const targetScore = rrfScores.get(link.targetChunkId)
        // A linked chunk outside the pool scores as the source chunk score ×
        // confidence × decay (used only for the final supplement).
        if (
          sourceScore !== undefined &&
          targetScore === undefined &&
          scopedLinkIds.has(link.targetChunkId)
        ) {
          const score = sourceScore * 0.5 * confidence
          linkedExtra.set(
            link.targetChunkId,
            Math.max(linkedExtra.get(link.targetChunkId) ?? 0, score)
          )
        } else if (
          targetScore !== undefined &&
          sourceScore === undefined &&
          scopedLinkIds.has(link.sourceChunkId)
        ) {
          const score = targetScore * 0.5 * confidence
          linkedExtra.set(
            link.sourceChunkId,
            Math.max(linkedExtra.get(link.sourceChunkId) ?? 0, score)
          )
        }
      }
    }

    const rerankCandidateIds = fusedRankedChunkIds.slice(
      0,
      Math.min(rerankTopN, fusedRankedChunkIds.length)
    )
    let rerankMethod: 'provider' | 'heuristic' | 'none' = 'none'
    let rerankScores = new Map<string, number>()
    let finalRankedChunkIds = fusedRankedChunkIds

    if (rerankEnabled && rerankCandidateIds.length > 1) {
      const rerankRows = db
        .select({ id: chunks.id, content: chunks.content })
        .from(chunks)
        .where(inArray(chunks.id, rerankCandidateIds))
        .all()
      const rerankContentMap = new Map(rerankRows.map((row) => [row.id, row.content]))

      const rerankCandidates = rerankCandidateIds.map((chunkId) => ({
        id: chunkId,
        text: rerankContentMap.get(chunkId) || '',
        baseScore: rrfScores.get(chunkId) || 0
      }))

      const rerankOutcome = await this.deps.rerankService.rerank(query, rerankCandidates, {
        enabled: true,
        topN: rerankTopN,
        heuristicFallback: rerankHeuristicFallback
      })
      rerankMethod = rerankOutcome.method
      rerankScores = rerankOutcome.scores

      const uniqueOrderedIds: string[] = []
      const seen = new Set<string>()
      for (const id of rerankOutcome.orderedIds) {
        if (!seen.has(id)) {
          uniqueOrderedIds.push(id)
          seen.add(id)
        }
      }

      for (const id of fusedRankedChunkIds) {
        if (!seen.has(id)) {
          uniqueOrderedIds.push(id)
          seen.add(id)
        }
      }

      finalRankedChunkIds = uniqueOrderedIds
    }

    const fusedChunkIds = finalRankedChunkIds.slice(0, topK)

    // Add linked chunks missing from top-K — at most 3, only when links exist.
    if (linkedExtra.size > 0) {
      const extras = [...linkedExtra.entries()]
        .filter(([chunkId]) => !fusedChunkIds.includes(chunkId))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      for (const [chunkId, score] of extras) {
        fusedChunkIds.push(chunkId)
        // Store the real score so the returned result does not report 0.
        rrfScores.set(chunkId, score)
      }
    }

    // 4. Fetch expanded context (parent-child strategy)
    const chunkDetails = db.select().from(chunks).where(inArray(chunks.id, fusedChunkIds)).all()
    const documentIds = [...new Set(chunkDetails.map((c) => c.documentId))]
    const documentDetails = db
      .select()
      .from(documents)
      .where(inArray(documents.id, documentIds))
      .all()
    const documentMap = new Map(documentDetails.map((d) => [d.id, d]))

    // Load only the section/neighbour chunks needed for context expansion.
    const chunkListByDoc = this.loadContextChunks(chunkDetails)

    const results: SearchResult[] = []

    // Create results mapping maintaining fused order
    for (const chunkId of fusedChunkIds) {
      const currentChunk = chunkDetails.find((c) => c.id === chunkId)
      if (!currentChunk) continue

      const doc = documentMap.get(currentChunk.documentId)
      const docChunks = chunkListByDoc.get(currentChunk.documentId) || []

      // Context expansion (small-to-big): prefer the whole section containing
      // the chunk, fall back to prev/current/next when no section structure.
      let expandedContent = currentChunk.content
      if (includeContent) {
        expandedContent = this.collectContextContents(docChunks, currentChunk).join('\n...\n')
      }

      const chunkMetadata = (currentChunk.metadata as Record<string, unknown> | null) || undefined
      const headingPath = this.extractHeadingPath(chunkMetadata)

      const result: SearchResult = {
        chunkId: currentChunk.id,
        documentId: currentChunk.documentId,
        documentTitle: doc?.title || 'Unknown',
        documentType: doc?.type || 'unknown',
        sourceUri: doc?.sourceUri || undefined,
        pageNumber: this.resolveChunkPageNumber(
          (doc?.metadata as Record<string, unknown>) || undefined,
          chunkMetadata,
          currentChunk.startOffset,
          currentChunk.endOffset
        ),
        sectionPath: headingPath,
        content: expandedContent,
        matchedContent: currentChunk.content,
        score: rerankScores.get(chunkId) ?? rrfScores.get(chunkId) ?? 0,
        chunkIndex: currentChunk.chunkIndex
      }
      if (chunkMetadata) result.metadata = chunkMetadata
      results.push(result)
    }

    Logger.debug('KnowledgeService', 'search_metrics', {
      notebookId,
      queryLength: query.length,
      topK,
      threshold,
      vectorCandidates: vectorResults.length,
      ftsCandidates: ftsResults.length,
      fusedCandidates: fusedRankedChunkIds.length,
      rerankEnabled,
      rerankMethod,
      rerankCandidates: rerankCandidateIds.length,
      returned: results.length,
      latencyMs: Date.now() - startedAt,
      scoped: !!scopeDocumentIds || !!scopeChunkIds,
      hierarchicalDocuments: hierarchicalDocumentIds.length,
      filterOverflow
    })

    return results
  }

  /**
   * Infer filter metadata from the question (number, document type, issuer)
   * and compare it with stored metadata. Only return a filter when the match
   * is unambiguous — otherwise retrieval runs normally to avoid empty scope.
   */
  detectMetadataFilter(notebookId: string, query: string): Record<string, string> | undefined {
    const signals = detectQueryMetadata(query)
    if (
      !signals.documentNumber &&
      signals.documentTypes.length === 0 &&
      signals.issuers.length === 0
    ) {
      return undefined
    }

    const rows = getDatabase()
      .select({ metadata: documents.metadata })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .all()
    const metadataList = rows
      .map((row) => extractLegalMetadata(row.metadata as Record<string, unknown> | null))
      .filter((value): value is Record<string, string> => !!value)

    if (metadataList.length === 0) return undefined

    return selectLegalMetadataFilter(metadataList, signals)
  }

  private resolveFilteredDocumentIds(
    notebookId: string,
    metadataFilter: SearchOptions['metadataFilter']
  ): string[] | null {
    if (!metadataFilter) return null

    const hasDocumentLevelFilter =
      !!metadataFilter.documentIds?.length ||
      !!metadataFilter.documentTypes?.length ||
      !!metadataFilter.sourceUriContains?.trim()

    const metadataEntries = Object.entries(metadataFilter.documentMetadata || {}).filter(
      ([, value]) => typeof value === 'string' && value.trim().length > 0
    )

    // sectionPath/pageRange only filter at chunk level — they do not limit documents.
    if (!hasDocumentLevelFilter && metadataEntries.length === 0) return null

    const filters = [eq(documents.notebookId, notebookId)]

    if (metadataFilter.documentIds?.length) {
      filters.push(inArray(documents.id, metadataFilter.documentIds))
    }

    if (metadataFilter.documentTypes?.length) {
      filters.push(inArray(documents.type, metadataFilter.documentTypes))
    }

    const db = getDatabase()
    const docs = db
      .select({
        id: documents.id,
        sourceUri: documents.sourceUri,
        metadata: documents.metadata
      })
      .from(documents)
      .where(and(...filters))
      .all()

    const normalizedSource = metadataFilter.sourceUriContains?.trim().toLowerCase()

    return docs
      .filter((doc) => {
        if (normalizedSource && !(doc.sourceUri || '').toLowerCase().includes(normalizedSource)) {
          return false
        }
        if (metadataEntries.length === 0) return true

        const documentMetadata = (doc.metadata as Record<string, unknown> | null)
          ?.documentMetadata as Record<string, unknown> | undefined
        if (!documentMetadata) return false

        return metadataEntries.every(
          ([key, value]) =>
            String(documentMetadata[key] ?? '')
              .trim()
              .toLowerCase() === value.trim().toLowerCase()
        )
      })
      .map((doc) => doc.id)
  }

  /**
   * Filter at chunk level by structural metadata (headingPath) and page range.
   */
  private matchesChunkMetadataFilter(
    chunkMetadata: Record<string, unknown> | null | undefined,
    filter: NonNullable<SearchOptions['metadataFilter']>
  ): boolean {
    const sectionPath = (filter.sectionPath || [])
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0)

    if (sectionPath.length > 0) {
      const headingPath = this.extractHeadingPath(chunkMetadata)
      if (!headingPath) return false

      const haystack = headingPath.map((part) => part.toLowerCase())
      let cursor = 0

      for (const needle of sectionPath) {
        const foundIndex = haystack.findIndex(
          (candidate, index) => index >= cursor && candidate.includes(needle)
        )
        if (foundIndex < 0) return false
        cursor = foundIndex + 1
      }
    }

    const pageRange = filter.pageRange
    if (pageRange) {
      const pageStart = chunkMetadata?.pageStart
      const pageEnd = chunkMetadata?.pageEnd ?? pageStart
      if (typeof pageStart !== 'number' || typeof pageEnd !== 'number') return false
      if (pageEnd < pageRange.from || pageStart > pageRange.to) return false
    }

    return true
  }

  /**
   * Filter at CHUNK level (heading path / page range). Returns null when no
   * filter is needed. Only used for sectionPath/pageRange — document scope is
   * filtered inside the KNN query through document_id.
   */
  private resolveChunkLevelFilterIds(
    notebookId: string,
    documentIds: string[] | null,
    metadataFilter: SearchOptions['metadataFilter']
  ): string[] | null {
    const needsChunkLevelFilter =
      !!metadataFilter?.sectionPath?.length || !!metadataFilter?.pageRange
    if (!needsChunkLevelFilter) return null
    if (documentIds && documentIds.length === 0) return []

    const db = getDatabase()
    const conditions = [eq(chunks.notebookId, notebookId)]

    if (documentIds) {
      conditions.push(inArray(chunks.documentId, documentIds))
    }

    return db
      .select({ id: chunks.id, metadata: chunks.metadata })
      .from(chunks)
      .where(and(...conditions))
      .all()
      .filter((row) =>
        this.matchesChunkMetadataFilter(
          (row.metadata as Record<string, unknown> | null) || undefined,
          metadataFilter!
        )
      )
      .map((row) => row.id)
  }

  /**
   * Number of fully indexed documents in the notebook (document-index
   * coverage check).
   */
  private countIndexedDocuments(notebookId: string, documentIds?: string[]): number {
    const db = getDatabase()
    if (documentIds && documentIds.length === 0) return 0
    const conditions = [eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')]
    if (documentIds) conditions.push(inArray(documents.id, documentIds))
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(and(...conditions))
      .get()

    return row?.count ?? 0
  }

  /**
   * Number of section records in the notebook (section-index coverage check).
   */
  private countSections(notebookId: string, documentIds?: string[]): number {
    const db = getDatabase()
    if (documentIds && documentIds.length === 0) return 0
    const conditions = [eq(sections.notebookId, notebookId)]
    if (documentIds) conditions.push(inArray(sections.documentId, documentIds))
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(sections)
      .where(and(...conditions))
      .get()

    return row?.count ?? 0
  }

  /**
   * Chunk ids belonging to the selected sections (section → chunk step of
   * hierarchical retrieval). Batched to avoid the SQLite parameter limit.
   */
  private chunkIdsBySectionIds(notebookId: string, sectionIds: string[]): string[] {
    if (sectionIds.length === 0) return []

    const db = getDatabase()
    const rows: Array<{ id: string }> = []

    for (let offset = 0; offset < sectionIds.length; offset += MAX_PARAMETERIZED_CHUNK_FILTER) {
      const batch = sectionIds.slice(offset, offset + MAX_PARAMETERIZED_CHUNK_FILTER)
      rows.push(
        ...db
          .select({ id: chunks.id })
          .from(chunks)
          .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.sectionId, batch)))
          .all()
      )
    }

    return rows.map((row) => row.id)
  }

  /**
   * Chunk set for the section tier of hierarchical retrieval:
   *  - chunks inside the selected sections, PLUS
   *  - chunks without a section in selected documents (documents with no
   *    section structure must not be filtered out by the section tier;
   *    otherwise txt/pdf/pptx would silently disappear from results).
   */
  private chunkIdsForSectionTier(
    notebookId: string,
    sectionIds: string[],
    documentIds?: string[]
  ): string[] {
    const db = getDatabase()
    const conditions = [eq(chunks.notebookId, notebookId), isNull(chunks.sectionId)]
    if (documentIds?.length) {
      conditions.push(inArray(chunks.documentId, documentIds))
    }

    const sectionless = db
      .select({ id: chunks.id })
      .from(chunks)
      .where(and(...conditions))
      .all()
      .map((row) => row.id)

    return [...this.chunkIdsBySectionIds(notebookId, sectionIds), ...sectionless]
  }

  /**
   * Documents matching the query by KEYWORD (document-level BM25 branch).
   * Merged into the document set selected by the vector tier to avoid losing
   * recall for keyword-heavy queries.
   */
  private findKeywordDocumentIds(notebookId: string, query: string, limit: number): string[] {
    const sqlite = getSqlite()
    if (!sqlite) return []

    const safeQuery = buildFtsMatchQuery(query)
    if (!safeQuery) return []

    try {
      const rows = sqlite
        .prepare(
          `SELECT c.document_id AS document_id
           FROM fts_chunks f
           JOIN chunks c ON c.id = f.chunk_id
           WHERE f.notebook_id = ? AND fts_chunks MATCH ?
           ORDER BY rank LIMIT ?`
        )
        .all(notebookId, safeQuery, limit) as Array<{
        document_id: string
      }>

      return [...new Set(rows.map((row) => row.document_id))]
    } catch (error) {
      Logger.warn('KnowledgeService', 'Keyword document lookup failed:', error)
      return []
    }
  }

  private getPageNumberForChunk(
    documentMetadata: Record<string, unknown> | null | undefined,
    startOffset: number | null,
    endOffset: number | null
  ): number | undefined {
    if (
      !documentMetadata ||
      startOffset === null ||
      startOffset === undefined ||
      endOffset === null ||
      endOffset === undefined
    ) {
      return undefined
    }

    const structure = documentMetadata.structure as PageStructure | undefined
    if (!structure || structure.type !== 'pages' || !Array.isArray(structure.pages)) {
      return undefined
    }

    const page = structure.pages.find((p) => {
      if (
        typeof p?.startOffset !== 'number' ||
        typeof p?.endOffset !== 'number' ||
        typeof p?.pageNumber !== 'number'
      ) {
        return false
      }

      return startOffset < p.endOffset && endOffset >= p.startOffset
    })

    return page?.pageNumber
  }

  /**
   * Context content for a hit chunk (small-to-big):
   *  - With a section anchor (sectionStart/sectionEnd) → all chunks in the
   *    same section.
   *  - Otherwise → prev + current + next as before.
   */
  private collectContextContents(docChunks: Chunk[], currentChunk: Chunk): string[] {
    const metadata = (currentChunk.metadata as Record<string, unknown> | null) || undefined
    const sectionStart = metadata?.sectionStart
    const sectionEnd = metadata?.sectionEnd

    if (typeof sectionStart === 'number' && typeof sectionEnd === 'number') {
      const inSection = docChunks.filter((candidate) => {
        const candidateMetadata =
          (candidate.metadata as Record<string, unknown> | null) || undefined
        const start = candidateMetadata?.sectionStart
        return typeof start === 'number' && start >= sectionStart && start < sectionEnd
      })

      if (inSection.length > 0 && inSection.length <= MAX_SECTION_CONTEXT_CHUNKS) {
        return [...inSection]
          .sort((a, b) => a.chunkIndex - b.chunkIndex)
          .map((candidate) => candidate.content)
      }
    }

    const cIndex = currentChunk.chunkIndex
    const prevChunk = docChunks.find((c) => c.chunkIndex === cIndex - 1)
    const nextChunk = docChunks.find((c) => c.chunkIndex === cIndex + 1)

    const contents: string[] = []
    if (prevChunk) contents.push(prevChunk.content)
    contents.push(currentChunk.content)
    if (nextChunk) contents.push(nextChunk.content)
    return contents
  }

  /**
   * Load only the chunks needed to expand a result: its section, or its
   * immediate neighbours when the document has no section index. Fetching
   * every chunk of every hit document is too expensive for large files.
   */
  private loadContextChunks(chunkDetails: Chunk[]): Map<string, Chunk[]> {
    const db = getDatabase()
    const byDocument = new Map<string, Chunk[]>()
    const seen = new Set<string>()

    const add = (chunk: Chunk): void => {
      if (seen.has(chunk.id)) return
      seen.add(chunk.id)
      const list = byDocument.get(chunk.documentId) ?? []
      list.push(chunk)
      byDocument.set(chunk.documentId, list)
    }

    const documentIds = [...new Set(chunkDetails.map((chunk) => chunk.documentId))]
    const sectionIds = [
      ...new Set(chunkDetails.map((chunk) => chunk.sectionId).filter(Boolean))
    ] as string[]

    if (documentIds.length > 0 && sectionIds.length > 0) {
      const sectionRows = db
        .select()
        .from(chunks)
        .where(and(inArray(chunks.documentId, documentIds), inArray(chunks.sectionId, sectionIds)))
        .all()
      sectionRows.forEach(add)
    }

    for (const chunk of chunkDetails) {
      const hasSectionRows =
        chunk.sectionId !== null &&
        chunk.sectionId !== undefined &&
        (byDocument.get(chunk.documentId) ?? []).some(
          (candidate) => candidate.sectionId === chunk.sectionId
        )
      if (hasSectionRows) continue

      const neighbours = db
        .select()
        .from(chunks)
        .where(
          and(
            eq(chunks.documentId, chunk.documentId),
            gte(chunks.chunkIndex, chunk.chunkIndex - 1),
            lte(chunks.chunkIndex, chunk.chunkIndex + 1)
          )
        )
        .all()
      neighbours.forEach(add)
    }

    for (const list of byDocument.values()) {
      list.sort((a, b) => a.chunkIndex - b.chunkIndex)
    }
    return byDocument
  }

  /**
   * Read the heading path attached at index time (chunk.metadata.headingPath).
   */
  private extractHeadingPath(
    chunkMetadata: Record<string, unknown> | null | undefined
  ): string[] | undefined {
    const headingPath = chunkMetadata?.headingPath
    if (!Array.isArray(headingPath)) return undefined

    const parts = headingPath.filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0
    )
    return parts.length > 0 ? parts : undefined
  }

  /**
   * Chunk page number: prefer pageStart attached at index time (all loaders),
   * fall back to documents.metadata.structure.pages for older rows.
   */
  private resolveChunkPageNumber(
    documentMetadata: Record<string, unknown> | null | undefined,
    chunkMetadata: Record<string, unknown> | null | undefined,
    startOffset: number | null,
    endOffset: number | null
  ): number | undefined {
    const pageStart = chunkMetadata?.pageStart
    if (typeof pageStart === 'number' && Number.isFinite(pageStart)) return pageStart

    return this.getPageNumberForChunk(documentMetadata, startOffset, endOffset)
  }
}
