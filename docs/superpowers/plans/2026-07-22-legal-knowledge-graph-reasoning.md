# Legal Knowledge Graph Reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build production-grade, evidence-first Vietnamese legal graph extraction and multi-hop reasoning without blocking normal RAG or adding external graph runtime.

**Architecture:** Persist typed nodes, relations, and jobs in SQLite. Indexing enqueues resumable enrichment using active chat model and AI SDK structured output; chat maps hybrid retrieval seeds into bounded recursive CTE traversal, validates every path against source chunks, and persists collapsed inline reasoning metadata.

**Tech Stack:** TypeScript, Electron, better-sqlite3, Drizzle ORM, SQLite recursive CTE, Vercel AI SDK 5, Zod 4, React 19, Zustand, Vitest.

---

## File Map

**Create:**
- `src/shared/types/legalReasoning.ts`
- `src/main/services/legalGraph/LegalModalityService.ts`
- `src/main/services/legalGraph/LegalGraphRepository.ts`
- `src/main/services/legalGraph/LegalGraphExtractionService.ts`
- `src/main/services/legalGraph/LegalGraphWorker.ts`
- `src/main/services/legalGraph/LegalReasoningService.ts`
- `src/main/services/legalGraph/legalGraphPrompt.ts`
- `src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx`
- `tests/rag/legalGraphSchema.test.ts`
- `tests/rag/legalModalityService.test.ts`
- `tests/rag/legalGraphRepository.test.ts`
- `tests/rag/legalGraphExtractionService.test.ts`
- `tests/rag/legalGraphWorker.test.ts`
- `tests/rag/legalReasoningService.test.ts`
- `tests/rag/legalGraphKnowledge.integration.test.ts`
- `tests/renderer/legalReasoningPathCard.test.ts`
- `tests/services/chatLegalReasoning.test.ts`

**Modify:**
- `src/main/db/schema.ts`
- `src/main/db/migrations/**`
- `src/main/providers/ProviderManager.ts`
- `src/main/services/LegalStructureService.ts`
- `src/main/services/KnowledgeService.ts`
- `src/main/services/LegalComparisonService.ts`
- `src/main/ipc/chatHandlers.ts`
- `src/main/ipc/knowledgeHandlers.ts`
- `src/main/ipc/validation.ts`
- `src/main/ipc/index.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/shared/types/chat.ts`
- `src/renderer/src/store/knowledgeStore.ts`
- `src/renderer/src/components/notebook/SourcePanel.tsx`
- `src/renderer/src/components/notebook/chat/MessageItem.tsx`
- `src/renderer/src/store/chatStore.ts`
- existing legal/RAG tests and `docs/legal-comparison-rag.md`

---

### Task 1: Add Shared Contracts and SQLite Schema

**Files:**
- Create: `src/shared/types/legalReasoning.ts`
- Modify: `src/main/db/schema.ts:118`
- Create: `tests/rag/legalGraphSchema.test.ts`
- Generate: `src/main/db/migrations/0013_legal_knowledge_graph.sql`
- Generate: `src/main/db/migrations/meta/0013_snapshot.json`
- Modify: `src/main/db/migrations/meta/_journal.json`

- [ ] **Step 1: Write failing schema test**

```ts
it('creates graph tables and bidirectional indexes', async () => {
  dbModule.initDatabase()
  dbModule.runMigrations()
  const objects = dbModule.getSqlite()!
    .prepare("SELECT name, type FROM sqlite_master WHERE name LIKE 'legal_%'")
    .all() as Array<{ name: string; type: string }>
  expect(objects).toEqual(expect.arrayContaining([
    { name: 'legal_nodes', type: 'table' },
    { name: 'legal_relations', type: 'table' },
    { name: 'legal_extraction_jobs', type: 'table' },
    { name: 'idx_legal_relations_source_type', type: 'index' },
    { name: 'idx_legal_relations_target_type', type: 'index' }
  ]))
})
```

Use same temp Electron `userData` setup/cleanup pattern as `tests/rag/knowledgeService.test.ts`.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalGraphSchema.test.ts`

Expected: FAIL because graph tables do not exist.

- [ ] **Step 3: Add closed shared contracts**

```ts
export const LEGAL_NODE_TYPES = [
  'document', 'article', 'clause', 'point',
  'subject', 'action', 'concept', 'sanction', 'external_reference'
] as const
export const LEGAL_RELATION_TYPES = [
  'references', 'defines', 'applies_to', 'requires', 'permits', 'prohibits',
  'exception_to', 'condition_for', 'sanction_for', 'amends', 'replaces', 'repeals'
] as const
export const LEGAL_JOB_STATUSES = ['pending', 'processing', 'retry', 'ready', 'failed'] as const
export const LEGAL_MODALITIES = ['obligation', 'permission', 'prohibition'] as const

export type LegalNodeType = (typeof LEGAL_NODE_TYPES)[number]
export type LegalRelationType = (typeof LEGAL_RELATION_TYPES)[number]
export type LegalGraphJobStatus = (typeof LEGAL_JOB_STATUSES)[number]
export type LegalModality = (typeof LEGAL_MODALITIES)[number]

export interface LegalModalityTag {
  type: LegalModality
  confidence: number
  evidenceText: string
  startOffset: number
  endOffset: number
}

export interface LegalReasoningStep {
  relationId: string
  relationType: LegalRelationType
  sourceNodeId: string
  sourceLabel: string
  targetNodeId: string
  targetLabel: string
  confidence: number
  citationIds: number[]
}

export interface LegalReasoningPath {
  score: number
  minimumConfidence: number
  steps: LegalReasoningStep[]
}

export interface LegalReasoningResult {
  intent: 'lookup' | 'obligation' | 'permission' | 'prohibition' | 'sanction' |
    'definition' | 'condition' | 'exception' | 'comparison' | 'applicability' | 'general'
  graphStatus: 'ready' | 'pending' | 'failed' | 'unavailable'
  paths: LegalReasoningPath[]
  limitations: string[]
}
```

- [ ] **Step 4: Add Drizzle tables**

Implement all approved fields and constraints. `legal_nodes` must have unique `(notebookId, nodeType, canonicalKey)`. `legal_relations` must have evidence/provenance/fingerprint and source/target indexes. `legal_extraction_jobs` must have status/version/progress/lease/retry timestamps and unique document ID.

```ts
export const legalNodes = sqliteTable('legal_nodes', {
  id: text('id').primaryKey(),
  notebookId: text('notebook_id').notNull().references(() => notebooks.id, { onDelete: 'cascade' }),
  documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  chunkId: text('chunk_id').references(() => chunks.id, { onDelete: 'cascade' }),
  nodeType: text('node_type', { enum: LEGAL_NODE_TYPES }).notNull(),
  canonicalKey: text('canonical_key').notNull(),
  label: text('label').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
  articleNumber: text('article_number'),
  clauseNumber: text('clause_number'),
  pointNumber: text('point_number'),
  startOffset: integer('start_offset'),
  endOffset: integer('end_offset'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, (table) => ({
  identityIdx: uniqueIndex('idx_legal_nodes_identity').on(table.notebookId, table.nodeType, table.canonicalKey),
  documentTypeIdx: index('idx_legal_nodes_document_type').on(table.documentId, table.nodeType),
  chunkIdx: index('idx_legal_nodes_chunk').on(table.chunkId),
  labelIdx: index('idx_legal_nodes_notebook_label').on(table.notebookId, table.label)
}))
```

- [ ] **Step 5: Generate named migration**

Run: `pnpm exec drizzle-kit generate --name legal_knowledge_graph`

Expected: `0013_legal_knowledge_graph.sql`, snapshot, journal entry. Inspect foreign-key cascades and indexes. Add SQL `CHECK(confidence >= 0 AND confidence <= 1)` if generator omits it.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalGraphSchema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types/legalReasoning.ts src/main/db/schema.ts src/main/db/migrations tests/rag/legalGraphSchema.test.ts
git commit -m "feat(legal-graph): add graph schema and contracts"
```

---

### Task 2: Add Deterministic Modality Tagging

**Files:**
- Create: `src/main/services/legalGraph/LegalModalityService.ts`
- Modify: `src/main/services/LegalStructureService.ts:24`
- Create: `tests/rag/legalModalityService.test.ts`
- Modify: `tests/rag/legalStructureService.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('tags all three modalities with absolute offsets', () => {
  const text = 'Doanh nghiệp phải báo cáo. Cơ quan có quyền kiểm tra. Không được tiết lộ dữ liệu.'
  expect(findLegalModalityHints(text, 100)).toEqual([
    expect.objectContaining({ type: 'obligation', evidenceText: 'phải', startOffset: 113 }),
    expect.objectContaining({ type: 'permission', evidenceText: 'có quyền' }),
    expect.objectContaining({ type: 'prohibition', evidenceText: 'Không được' })
  ])
})

it('does not treat passive bare được as permission', () => {
  expect(findLegalModalityHints('Hồ sơ được lưu tại cơ quan.', 0)).toEqual([])
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalModalityService.test.ts tests/rag/legalStructureService.test.ts`

Expected: FAIL because service and `modalities` field do not exist.

- [ ] **Step 3: Implement lexical hints**

```ts
const PATTERNS = [
  { type: 'prohibition', pattern: /\b(không\s+được|nghiêm\s+cấm|cấm)\b/giu },
  { type: 'obligation', pattern: /\b(phải|có\s+trách\s+nhiệm|có\s+nghĩa\s+vụ|bắt\s+buộc)\b/giu },
  { type: 'permission', pattern: /\b(có\s+quyền|được\s+phép|được\s+quyền)\b/giu }
] as const
```

Return sorted `LegalModalityTag[]` with confidence `0.55`; never match bare `được`.

- [ ] **Step 4: Extend `LegalChunkContext`**

Add `modalities?: LegalModalityTag[]`. Keep `getLegalContextAt` hierarchy-only; `KnowledgeService` attaches hints from actual chunk text so evidence offsets remain correct.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalModalityService.test.ts tests/rag/legalStructureService.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/legalGraph/LegalModalityService.ts src/main/services/LegalStructureService.ts tests/rag/legalModalityService.test.ts tests/rag/legalStructureService.test.ts
git commit -m "feat(legal-graph): tag legal modalities"
```

---

### Task 3: Implement Graph Repository and Queue

**Files:**
- Create: `src/main/services/legalGraph/LegalGraphRepository.ts`
- Create: `tests/rag/legalGraphRepository.test.ts`

- [ ] **Step 1: Write failing repository tests**

```ts
it('replaces one document graph atomically and preserves another', () => {
  repository.replaceDocumentGraph(documentA, candidateA, provenance)
  repository.replaceDocumentGraph(documentB, candidateB, provenance)
  repository.replaceDocumentGraph(documentA, replacementA, provenance)
  expect(repository.getDocumentGraph(documentA).relations).toHaveLength(1)
  expect(repository.getDocumentGraph(documentB).relations).toHaveLength(2)
})

it('claims due jobs and recovers expired leases', () => {
  repository.enqueueDocument(documentA, notebookId)
  expect(repository.claimNextJob('worker-1', now, 30_000)?.status).toBe('processing')
  repository.recoverExpiredLeases(new Date(now.getTime() + 31_000))
  expect(repository.getJob(documentA)?.status).toBe('retry')
})

it('rejects cross-notebook edges', () => {
  expect(() => repository.replaceDocumentGraph(documentA, crossNotebookCandidate, provenance))
    .toThrow('Legal graph candidate crosses notebook boundary')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalGraphRepository.test.ts`

Expected: FAIL because repository does not exist.

- [ ] **Step 3: Add candidate contracts**

```ts
export interface LegalGraphCandidateNode {
  localId: string
  nodeType: LegalNodeType
  canonicalKey: string
  label: string
  aliases: string[]
  chunkId?: string
  articleNumber?: string
  clauseNumber?: string
  pointNumber?: string
  startOffset?: number
  endOffset?: number
  metadata?: Record<string, unknown>
}

export interface LegalGraphCandidateRelation {
  sourceLocalId: string
  targetLocalId: string
  relationType: LegalRelationType
  evidenceChunkId: string
  evidenceText: string
  evidenceStartOffset: number
  evidenceEndOffset: number
  confidence: number
  qualifiers?: Record<string, unknown>
}
```

- [ ] **Step 4: Implement repository methods**

```ts
enqueueDocument(documentId: string, notebookId: string): void
claimNextJob(workerId: string, now: Date, leaseMs: number): LegalExtractionJob | undefined
heartbeat(jobId: string, workerId: string, now: Date, leaseMs: number): boolean
markJobRetry(jobId: string, error: Error, now: Date): void
markJobFailed(jobId: string, error: Error, now: Date): void
recoverExpiredLeases(now: Date): number
replaceDocumentGraph(documentId: string, candidate: LegalGraphCandidate, provenance: LegalGraphProvenance): void
getDocumentGraphStatus(documentId: string): LegalGraphDocumentStatus
retryDocument(documentId: string): void
deleteDocumentGraph(documentId: string): void
```

Use `better-sqlite3.transaction`, SHA-256 fingerprints, parameterized statements, and 500-character sanitized errors. Retry delay: `min(30 minutes, 5 seconds * 2^(attempts-1))`.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalGraphRepository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/legalGraph/LegalGraphRepository.ts tests/rag/legalGraphRepository.test.ts
git commit -m "feat(legal-graph): persist graph and extraction jobs"
```

---

### Task 4: Add Recursive Traversal and Revision Cache

**Files:**
- Modify: `src/main/services/legalGraph/LegalGraphRepository.ts`
- Modify: `tests/rag/legalGraphRepository.test.ts`

- [ ] **Step 1: Write failing traversal tests**

```ts
it('traverses inbound and outbound paths without cycles', () => {
  const paths = repository.traverse({
    notebookId,
    seedNodeIds: [article15Id],
    relationTypes: ['requires', 'references', 'sanction_for'],
    maxDepth: 4,
    maxPaths: 20,
    minimumConfidence: 0.75
  })
  expect(paths[0].steps.map((step) => step.relationType)).toEqual([
    'requires', 'references', 'sanction_for'
  ])
  expect(paths.every((path) => new Set(path.nodeIds).size === path.nodeIds.length)).toBe(true)
})
```

Also test notebook revision increments after replace/delete and stale cache is not reused.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalGraphRepository.test.ts`

Expected: FAIL because traversal does not exist.

- [ ] **Step 3: Implement parameterized recursive CTE**

Use inbound/outbound union, comma-delimited visited node IDs, max depth, confidence product, notebook predicate, and bound result limit. Add:

```ts
// ponytail: desktop traversal caps paths at four hops; introduce a graph adapter only when notebook graphs exceed SQLite limits.
```

- [ ] **Step 4: Add bounded adjacency cache**

Cache adjacency per `{notebookId, revision}`, 10,000-edge ceiling, LRU notebook eviction. Increment revision on replace, reconciliation, delete, and reindex cleanup. SQLite remains source of truth.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalGraphRepository.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/legalGraph/LegalGraphRepository.ts tests/rag/legalGraphRepository.test.ts
git commit -m "feat(legal-graph): traverse bounded evidence paths"
```

---

### Task 5: Implement Structured Triple Extraction

**Files:**
- Create: `src/main/services/legalGraph/legalGraphPrompt.ts`
- Create: `src/main/services/legalGraph/LegalGraphExtractionService.ts`
- Modify: `src/main/providers/ProviderManager.ts:82`
- Create: `tests/rag/legalGraphExtractionService.test.ts`

- [ ] **Step 1: Write failing extractor tests**

```ts
const generateTextMock = vi.hoisted(() => vi.fn())
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock
}))

it('accepts evidence-backed closed triples', async () => {
  generateTextMock.mockResolvedValue({ output: validOutput })
  const candidate = await extractor.extractDocument(document, chunks, activeModel)
  expect(candidate.relations).toEqual([
    expect.objectContaining({ relationType: 'requires', evidenceChunkId: chunk.id })
  ])
})

it('rejects invented evidence', async () => {
  generateTextMock.mockResolvedValue({ output: outputWithInventedQuote })
  await expect(extractor.extractDocument(document, chunks, activeModel))
    .rejects.toThrow('Evidence text is not present in source chunk')
})

it('rejects unknown predicates', async () => {
  generateTextMock.mockResolvedValue({ output: outputWithUnknownPredicate })
  await expect(extractor.extractDocument(document, chunks, activeModel)).rejects.toThrow()
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalGraphExtractionService.test.ts`

Expected: FAIL because extractor does not exist.

- [ ] **Step 3: Expose active AI SDK model and provenance**

```ts
import type { LanguageModel } from 'ai'

export interface ActiveChatLanguageModel {
  model: LanguageModel
  provenance: string
}

async getActiveChatLanguageModel(): Promise<ActiveChatLanguageModel | null> {
  const provider = await this.getActiveChatProvider()
  if (!provider || !(provider instanceof AISDKProvider)) return null
  const settings = await settingsManager.getAllSettings()
  return {
    model: provider.getAIModel(),
    provenance: settings.defaultChatModel || `${provider.name}:${provider.getDefaultChatModel()}`
  }
}
```

Reuse current local-first provider policy.

- [ ] **Step 4: Add versions and strict Zod schema**

```ts
export const LEGAL_GRAPH_EXTRACTOR_VERSION = '1'
export const LEGAL_GRAPH_PROMPT_VERSION = '1'
export const LEGAL_GRAPH_ONTOLOGY_VERSION = '1'

export const legalGraphOutputSchema = z.object({
  nodes: z.array(z.object({
    localId: z.string().min(1).max(100),
    type: z.enum(['subject', 'action', 'concept', 'sanction', 'external_reference']),
    label: z.string().min(1).max(300),
    aliases: z.array(z.string().min(1).max(300)).max(10).default([])
  })).max(100),
  relations: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    type: z.enum(LEGAL_RELATION_TYPES),
    confidence: z.number().min(0).max(1),
    evidenceText: z.string().min(1).max(800),
    qualifiers: z.record(z.string(), z.unknown()).optional()
  })).max(200)
})
```

Prompt predeclares source nodes, requires JSON only, forbids unsupported legal effect, and instructs model to omit uncertain relations.

- [ ] **Step 5: Call AI SDK structured output**

```ts
const result = await generateText({
  model: activeModel.model,
  experimental_output: Output.object({ schema: legalGraphOutputSchema }),
  prompt,
  maxRetries: 2,
  abortSignal: AbortSignal.timeout(90_000)
})
if (!result.experimental_output) throw new Error('No legal graph object generated')
```

Catch `NoObjectGeneratedError`; rethrow retryable error without logging raw output.

- [ ] **Step 6: Validate/canonicalize candidates**

Locate evidence by exact NFC-normalized substring, calculate original offsets, validate endpoints/coordinates/notebook ownership/duplicate IDs, create deterministic document/article/clause/point source nodes, normalize semantic keys and aliases, and create unresolved `external_reference` nodes for missing cited documents.

- [ ] **Step 7: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalGraphExtractionService.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/providers/ProviderManager.ts src/main/services/legalGraph/legalGraphPrompt.ts src/main/services/legalGraph/LegalGraphExtractionService.ts tests/rag/legalGraphExtractionService.test.ts
git commit -m "feat(legal-graph): extract evidence-backed triples"
```

---

### Task 6: Implement Resumable Background Worker

**Files:**
- Create: `src/main/services/legalGraph/LegalGraphWorker.ts`
- Create: `tests/rag/legalGraphWorker.test.ts`

- [ ] **Step 1: Write failing worker tests**

```ts
it('does not claim work while chat is active', async () => {
  worker.setChatActive(true)
  await worker.runOnce()
  expect(repository.claimCalls).toBe(0)
})

it('retries transient model failure and preserves old graph', async () => {
  extractor.extractDocument.mockRejectedValue(new LegalGraphRetryableError('model unavailable'))
  await worker.runOnce()
  expect(repository.markRetryCalls).toBe(1)
  expect(repository.replaceCalls).toBe(0)
})

it('recovers leases and backfills stale versions on start', async () => {
  await worker.start()
  expect(repository.recoverExpiredLeases).toHaveBeenCalledOnce()
  expect(repository.enqueueStaleDocuments).toHaveBeenCalledWith(currentVersions)
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalGraphWorker.test.ts`

Expected: FAIL because worker does not exist.

- [ ] **Step 3: Implement worker API**

```ts
start(): Promise<void>
stop(timeoutMs?: number): Promise<void>
setChatActive(active: boolean): void
runOnce(): Promise<boolean>
retryDocument(documentId: string): void
```

`runOnce` claims one job, resolves active model, loads source units, extracts, replaces graph, and marks ready. Heartbeat between units. Concurrency remains one.

```ts
// ponytail: one extraction worker protects local model latency; raise concurrency only after model-level scheduling exists.
```

- [ ] **Step 4: Implement safe polling/shutdown**

Use one unref'd timeout after each `runOnce`, not `setInterval`. `stop` clears timeout, prevents claims, waits for active promise with bounded `Promise.race`, then releases worker leases.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalGraphWorker.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/legalGraph/LegalGraphWorker.ts tests/rag/legalGraphWorker.test.ts
git commit -m "feat(legal-graph): run resumable extraction worker"
```

---

### Task 7: Integrate Indexing, Reindex, Delete, Status, and IPC

**Files:**
- Modify: `src/main/services/KnowledgeService.ts:443`
- Modify: `src/main/ipc/knowledgeHandlers.ts:249`
- Modify: `src/main/ipc/validation.ts:278`
- Modify: `src/preload/index.ts:189`
- Modify: `src/preload/index.d.ts:251`
- Modify: `src/renderer/src/store/knowledgeStore.ts:101`
- Modify: `tests/rag/knowledgeService.test.ts`
- Create: `tests/rag/legalGraphKnowledge.integration.test.ts`

- [ ] **Step 1: Write failing integration tests**

```ts
it('finishes indexing before graph extraction and enqueues one job', async () => {
  const documentId = await service.addDocument(notebookId, legalDocumentOptions)
  expect(service.getDocument(documentId)?.status).toBe('indexed')
  expect(repository.getJob(documentId)?.status).toBe('pending')
})

it('reindex marks graph pending without exposing stale paths', async () => {
  seedReadyGraph(documentId)
  await service.reindexDocument(documentId)
  expect(repository.getDocumentGraphStatus(documentId).status).toBe('pending')
})

it('delete removes graph and job state', async () => {
  await service.deleteDocument(documentId)
  expect(repository.getJob(documentId)).toBeUndefined()
  expect(repository.getDocumentGraph(documentId).relations).toEqual([])
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/knowledgeService.test.ts tests/rag/legalGraphKnowledge.integration.test.ts`

Expected: FAIL because indexing has no graph integration.

- [ ] **Step 3: Inject repository and attach hints**

```ts
private legalGraphRepository?: LegalGraphRepository

constructor(providerManager: ProviderManager, legalGraphRepository?: LegalGraphRepository) {
  this.embeddingService = new EmbeddingService(providerManager)
  this.chunkingService = new ChunkingService()
  this.fileParserService = new FileParserService()
  this.rerankService = new RerankService(providerManager)
  this.legalGraphRepository = legalGraphRepository
  this.knowledgeFilesDir = join(app.getPath('userData'), 'knowledge-files')
  void this.ensureKnowledgeFilesDir()
}
```

After document reaches `indexed`, enqueue only when `legalStructure` exists. During `addLegalStructureToChunks`, set `legalContext.modalities = findLegalModalityHints(chunk.content, chunk.startOffset)`.

- [ ] **Step 4: Handle reindex/delete safely**

Before content reindex deletes old chunks, invalidate and delete current document graph because citation chunk IDs and offsets are changing. Successful new chunks enqueue immediate rebuild. Version-only extractor refresh keeps old ready graph until transactional replacement succeeds. Delete cascades graph/job rows and invalidates cache. Failed extraction never changes document status.

```ts
// ponytail: content reindex invalidates graph because citations change; add staged chunk versions only if zero-gap graph availability becomes required.
```

- [ ] **Step 5: Add status/retry IPC**

Channels:

```ts
'knowledge:get-legal-graph-status' // { documentId }
'knowledge:retry-legal-graph'      // { documentId }
'knowledge:graph-progress'         // push progress payload
```

Validate IDs, enforce document existence, expose typed preload methods, and merge progress into Zustand.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/knowledgeService.test.ts tests/rag/legalGraphKnowledge.integration.test.ts tests/ipcValidation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/KnowledgeService.ts src/main/ipc/knowledgeHandlers.ts src/main/ipc/validation.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/store/knowledgeStore.ts tests/rag/knowledgeService.test.ts tests/rag/legalGraphKnowledge.integration.test.ts tests/ipcValidation.test.ts
git commit -m "feat(legal-graph): connect indexing and graph jobs"
```

---

### Task 8: Implement Multi-Hop LegalReasoningService

**Files:**
- Create: `src/main/services/legalGraph/LegalReasoningService.ts`
- Modify: `src/main/services/LegalComparisonService.ts`
- Create: `tests/rag/legalReasoningService.test.ts`
- Modify: `tests/rag/legalComparisonService.test.ts`

- [ ] **Step 1: Write failing reasoning tests**

```ts
it('builds obligation to sanction path from seed evidence', () => {
  const result = service.reason('Doanh nghiệp bị xử lý thế nào nếu không nộp hồ sơ?', seeds)
  expect(result.intent).toBe('sanction')
  expect(result.paths[0].steps.map((step) => step.relationType)).toEqual([
    'requires', 'sanction_for'
  ])
})

it('returns pending limitation instead of fabricated path', () => {
  repository.getNotebookGraphStatus.mockReturnValue('pending')
  const result = service.reason('Nghĩa vụ là gì?', seeds)
  expect(result).toMatchObject({ graphStatus: 'pending', paths: [] })
})

it('keeps comparison compatibility and refuses unverified priority', () => {
  const result = service.reason('Văn bản nào ưu tiên áp dụng?', comparisonSeeds)
  expect(result.intent).toBe('applicability')
  expect(result.comparison?.resolution.status).toBe('needs_metadata')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalReasoningService.test.ts tests/rag/legalComparisonService.test.ts`

Expected: FAIL because reasoning service does not exist.

- [ ] **Step 3: Implement deterministic intent classification**

Use NFC-normalized Vietnamese patterns for obligation, permission, prohibition, sanction, definition, condition, exception, comparison, and applicability. Unknown query uses `general`; no LLM intent call.

- [ ] **Step 4: Traverse intent-specific predicates**

```ts
const predicatesByIntent = {
  sanction: ['requires', 'prohibits', 'condition_for', 'exception_to', 'sanction_for', 'references'],
  obligation: ['requires', 'condition_for', 'exception_to', 'references'],
  permission: ['permits', 'condition_for', 'exception_to', 'references'],
  prohibition: ['prohibits', 'exception_to', 'sanction_for', 'references'],
  definition: ['defines', 'references'],
  comparison: ['amends', 'replaces', 'repeals', 'references'],
  applicability: ['amends', 'replaces', 'repeals', 'applies_to', 'exception_to']
} satisfies Partial<Record<LegalReasoningIntent, LegalRelationType[]>>
```

- [ ] **Step 5: Score and validate**

Use `seedScore * confidenceProduct * 0.82^(depth-1) * evidenceCoverage * intentWeight`. Reject any relation below `0.75`, missing allowed chunk/citation, crossing notebook, or stale. Keep at most 3 paths and 8 expanded evidence chunks.

- [ ] **Step 6: Build factual prompt context**

```text
ĐƯỜNG DẪN BẰNG CHỨNG 1
[1] Điều 15 --requires--> Hành vi nộp hồ sơ
[2] Chế tài chậm nộp --sanction_for--> Hành vi nộp hồ sơ
Chỉ dùng quan hệ trên khi trích dẫn nguồn tương ứng. Không tạo quan hệ mới.
```

- [ ] **Step 7: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalReasoningService.test.ts tests/rag/legalComparisonService.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/legalGraph/LegalReasoningService.ts src/main/services/LegalComparisonService.ts tests/rag/legalReasoningService.test.ts tests/rag/legalComparisonService.test.ts
git commit -m "feat(legal-graph): reason over validated evidence paths"
```

---

### Task 9: Integrate Reasoning into Chat Streaming and Persistence

**Files:**
- Modify: `src/shared/types/chat.ts:20`
- Modify: `src/main/ipc/chatHandlers.ts:251`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/src/store/chatStore.ts:310`
- Create: `tests/services/chatLegalReasoning.test.ts`

- [ ] **Step 1: Write failing chat tests**

```ts
it('persists identical reasoning metadata sent in finish event', async () => {
  await sendLegalMessage('Doanh nghiệp bị phạt thế nào?')
  expect(finishEvent.metadata.legalReasoning).toEqual(reasoningResult)
  expect(savedMessage.metadata.legalReasoning).toEqual(reasoningResult)
})

it('pauses worker during stream and resumes in finally', async () => {
  await sendLegalMessage('Nghĩa vụ là gì?')
  expect(worker.setChatActive.mock.calls).toEqual([[true], [false]])
})

it('removes citation markers outside allowed evidence', async () => {
  modelText = 'Kết luận [1] [99].'
  await sendLegalMessage('Nghĩa vụ là gì?')
  expect(savedMessage.content).not.toContain('[99]')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/services/chatLegalReasoning.test.ts`

Expected: FAIL because handler has no reasoning integration.

- [ ] **Step 3: Add optional chat metadata**

```ts
export interface ChatMessageMetadata {
  // existing fields
  legalReasoning?: LegalReasoningResult
}
```

Add same field to stream chunk metadata.

- [ ] **Step 4: Inject services and prioritize chat**

`registerChatHandlers` receives `LegalReasoningService` and `LegalGraphWorker`. Set chat active immediately before provider stream. Resume in error, completion, abort, and stale cleanup using idempotent helper.

- [ ] **Step 5: Merge expanded evidence**

Deduplicate by `chunkId`, assign stable citation indices, respect current context caps, and build reasoning context only from validated paths. Keep compatible `legalComparison` field.

- [ ] **Step 6: Persist/stream one metadata object**

Use same object for `queries.updateMessageContent` and final `message-chunk`. Validate all citation markers against direct plus graph-expanded evidence.

- [ ] **Step 7: Verify GREEN**

Run: `pnpm exec vitest run tests/services/chatLegalReasoning.test.ts tests/rag/legalComparisonKnowledge.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types/chat.ts src/main/ipc/chatHandlers.ts src/main/ipc/index.ts src/renderer/src/store/chatStore.ts tests/services/chatLegalReasoning.test.ts tests/rag/legalComparisonKnowledge.integration.test.ts
git commit -m "feat(legal-graph): use reasoning paths in chat"
```

---

### Task 10: Add Inline Reasoning Card and Graph Status UI

**Files:**
- Create: `src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx`
- Modify: `src/renderer/src/components/notebook/chat/MessageItem.tsx:191`
- Modify: `src/renderer/src/components/notebook/SourcePanel.tsx:225`
- Create: `tests/renderer/legalReasoningPathCard.test.ts`

- [ ] **Step 1: Write failing renderer tests**

```ts
it('renders collapsed header without exposing steps initially', () => {
  const html = renderToStaticMarkup(<LegalReasoningPathCard result={result} />)
  expect(html).toContain('Đường suy luận pháp lý')
  expect(html).toContain('3 bước')
  expect(html).not.toContain('sanction_for')
})

it('formats graph states and Vietnamese predicates', () => {
  expect(getGraphStatusLabel('pending')).toBe('Đang chờ phân tích đồ thị')
  expect(getRelationLabel('sanction_for')).toBe('chế tài cho')
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/renderer/legalReasoningPathCard.test.ts`

Expected: FAIL because card/helpers do not exist.

- [ ] **Step 3: Implement accessible collapsed card**

Use native button with `aria-expanded`, status, step count, minimum confidence, and current Tailwind style. Expanded rows show source, Vietnamese relation label, target, confidence, and citation buttons. Never show extractor prompt/raw output.

- [ ] **Step 4: Reuse Citation Inspector**

Pass `onCitationClick(index)` from `MessageItem`; route through existing `handleCitationClick`. Render after model `ReasoningContent`, before comparison card and answer text.

- [ ] **Step 5: Add graph lifecycle panel**

`SourcePanel` requests selected document status, subscribes to progress, and renders pending/processing/retry/ready/failed. Failed state calls `retryLegalGraph(document.id)` and refreshes status. Document stays usable.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm exec vitest run tests/renderer/legalReasoningPathCard.test.ts tests/renderer/documentNavigation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/notebook/chat/LegalReasoningPathCard.tsx src/renderer/src/components/notebook/chat/MessageItem.tsx src/renderer/src/components/notebook/SourcePanel.tsx tests/renderer/legalReasoningPathCard.test.ts
git commit -m "feat(legal-graph): show auditable reasoning paths"
```

---

### Task 11: Wire Startup, Backfill, Progress, and Shutdown

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/knowledgeHandlers.ts`
- Modify: `src/main/services/legalGraph/LegalGraphWorker.ts`
- Modify: `tests/rag/legalGraphWorker.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('starts with lease recovery and automatic backfill', async () => {
  await worker.start()
  expect(repository.recoverExpiredLeases).toHaveBeenCalled()
  expect(repository.enqueueStaleDocuments).toHaveBeenCalledWith(versionSet)
})

it('bounded stop clears polling and releases leases', async () => {
  const active = worker.runOnce()
  await worker.stop(50)
  expect(worker.isRunning()).toBe(false)
  expect(repository.releaseWorkerLeases).toHaveBeenCalledWith(worker.id)
  await active.catch(() => undefined)
})
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/rag/legalGraphWorker.test.ts`

Expected: FAIL until lifecycle behavior exists.

- [ ] **Step 3: Construct runtime in main**

```ts
const legalGraphRepository = new LegalGraphRepository()
const legalGraphExtractor = new LegalGraphExtractionService(providerManager)
const legalGraphWorker = new LegalGraphWorker(legalGraphRepository, legalGraphExtractor, providerManager)
const legalReasoningService = new LegalReasoningService(legalGraphRepository, new LegalComparisonService())
knowledgeService = new KnowledgeService(providerManager, legalGraphRepository)
```

Pass worker/reasoning into IPC and call `void legalGraphWorker.start()` after registration.

- [ ] **Step 4: Await bounded worker stop on quit**

On first `before-quit`, call `event.preventDefault()`, set guard, await worker stop for 5 seconds, unregister shortcuts, stop llama, checkpoint/close DB, then call `app.quit()`. Signal fallback sets immediate stop flag before DB close.

- [ ] **Step 5: Emit progress safely**

Worker progress listener forwards to live renderer windows using existing index-progress pattern. Drop destroyed webContents.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm exec vitest run tests/rag/legalGraphWorker.test.ts tests/ipcValidation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/main/ipc/index.ts src/main/ipc/knowledgeHandlers.ts src/main/services/legalGraph/LegalGraphWorker.ts tests/rag/legalGraphWorker.test.ts tests/ipcValidation.test.ts
git commit -m "feat(legal-graph): start backfill and stop worker safely"
```

---

### Task 12: End-to-End Regression and Release Verification

**Files:**
- Modify: `tests/rag/legalGraphKnowledge.integration.test.ts`
- Modify: `tests/rag-behavior-eval/test_cases.json`
- Modify: `docs/legal-comparison-rag.md`

- [ ] **Step 1: Add full runtime integration test**

```ts
it('indexes, extracts, traverses, restarts, and deletes cleanly', async () => {
  const documentId = await indexLegalFixture()
  await worker.runOnce()
  const first = reasoning.reason('Chậm nộp hồ sơ bị xử lý thế nào?', await searchSeeds())
  expect(first.paths[0].steps.length).toBeGreaterThanOrEqual(2)

  await reopenDatabase()
  const second = reasoning.reason('Chậm nộp hồ sơ bị xử lý thế nào?', await searchSeeds())
  expect(second.paths).toEqual(first.paths)

  await knowledgeService.deleteDocument(documentId)
  expect(repository.getDocumentGraphStatus(documentId).relationCount).toBe(0)
})
```

- [ ] **Step 2: Run focused legal suites**

```bash
pnpm exec vitest run tests/rag/legalGraphSchema.test.ts tests/rag/legalModalityService.test.ts tests/rag/legalGraphRepository.test.ts tests/rag/legalGraphExtractionService.test.ts tests/rag/legalGraphWorker.test.ts tests/rag/legalReasoningService.test.ts tests/rag/legalGraphKnowledge.integration.test.ts tests/renderer/legalReasoningPathCard.test.ts tests/services/chatLegalReasoning.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Add behavioral evals**

Add obligation, permission, prohibition, exception, sanction multi-hop, pending fallback, unverified applicability, and invalid-citation cases. Expected answers require original citations and forbid unsupported priority conclusions.

- [ ] **Step 4: Update documentation**

Document statuses, async backfill, retry, ontology, evidence/confidence policy, inline reasoning path, and limitation that graph assists retrieval while original legal text remains authority.

- [ ] **Step 5: Run full tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 7: Run lint**

Run: `pnpm run lint`

Expected: PASS with no new warnings.

- [ ] **Step 8: Run production build**

Run: `pnpm run build`

Expected: PASS.

- [ ] **Step 9: Run security checks**

Run: `pnpm run check:security`

Expected: audit and security tests PASS. Record unrelated existing advisories; do not fix unrelated code.

- [ ] **Step 10: Run packaged smoke**

Run: `pnpm run check:package`

Expected: package starts, migrates existing DB, and passes smoke script.

- [ ] **Step 11: Review final diff**

```bash
git status --short
git diff --check
git diff --stat
git diff -- src/main/db/schema.ts src/main/services/legalGraph src/main/ipc/chatHandlers.ts src/shared/types/chat.ts src/renderer/src/components/notebook/chat
```

Confirm no models, binaries, build output, raw source excerpts, credentials, or `.superpowers/` files are tracked.

- [ ] **Step 12: Commit eval/docs changes**

```bash
git add tests/rag-behavior-eval/test_cases.json tests/rag/legalGraphKnowledge.integration.test.ts docs/legal-comparison-rag.md
git commit -m "test(legal-graph): verify production reasoning runtime"
```


