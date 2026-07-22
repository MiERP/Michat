# Legal Knowledge Graph Reasoning Design

## Status

- Approved: data/worker, extraction/modality, reasoning, runtime/UI.
- Target: production runtime, not prototype or MVP.
- Storage: SQLite-native graph; no external graph service or new runtime dependency.

## Goal

Upgrade MiChat from article-aware hybrid RAG to evidence-first legal graph reasoning that:

- tags legal chunks with obligation, permission, and prohibition modalities;
- persists horizontal relationships between legal provisions;
- extracts typed triples asynchronously with active chat model;
- traverses multi-hop legal paths before answer synthesis;
- displays compact, auditable reasoning paths backed by original citations;
- keeps normal RAG available while graph enrichment is pending or unavailable.

## Non-Goals

- No case-law ingestion or precedent weighting.
- No Neo4j, ArangoDB, RDF server, or network graph service.
- No free-form LLM predicates.
- No display or persistence of model chain-of-thought.
- No graph relation may replace original legal text as answer evidence.

## Decisions

1. Graph extraction runs asynchronously after document indexing.
2. Jobs persist in SQLite, retry with backoff, and recover after restart.
3. Extraction uses active chat model at execution time.
4. Existing triples keep model provenance when active model changes.
5. Re-extraction occurs when extractor, prompt, or ontology version changes.
6. Every accepted relation requires source evidence and confidence.
7. Predicate vocabulary is closed.
8. Existing legal documents receive automatic background backfill.
9. Reasoning path appears inline and collapsed by default.
10. SQLite remains single durable source of truth.

## Architecture

### Components

`LegalStructureService`

- Continues deterministic parsing of document, chapter, section, article, clause, and point structure.
- Creates canonical source-node identities; LLM never invents source-node IDs.

`LegalModalityService`

- Produces deterministic lexical hints from Vietnamese legal language.
- Validates final modality tags derived from accepted graph relations.
- Supports multiple modalities in one chunk.

`LegalGraphExtractionService`

- Builds bounded prompts per legal source unit.
- Calls active chat model through AI SDK structured output.
- Validates response with Zod and evidence gates.
- Returns complete document graph candidate without partial writes.

`LegalGraphRepository`

- Owns graph persistence, replacement transactions, recursive traversal, lookup, cache invalidation, and deletion.
- Uses raw SQLite recursive CTE where Drizzle cannot express traversal safely.

`LegalGraphWorker`

- Owns persistent queue polling, job leases, retry, backfill, pause/resume, and bounded shutdown.
- Runs one extraction at a time.
- Does not mark source document failed when graph enrichment fails.

`LegalReasoningService`

- Classifies legal query intent using deterministic patterns first.
- Receives hybrid retrieval seeds from `KnowledgeService`.
- Traverses graph with intent-specific predicates.
- Validates every path against original source chunks.
- Produces structured context for answer synthesis and renderer metadata.

`LegalComparisonService`

- Remains compatible with current public behavior and tests.
- Becomes strategy used by `LegalReasoningService` for comparison and applicability queries.
- Keeps conservative `needs_metadata` behavior for unverified effective dates or status.

### Runtime Flow

1. `KnowledgeService` parses and indexes document normally.
2. Legal chunks, FTS rows, and embeddings commit successfully.
3. `KnowledgeService` enqueues or refreshes one graph extraction job.
4. `LegalGraphWorker` waits until chat is idle and claims job lease.
5. `LegalGraphExtractionService` processes source units with active chat model.
6. Validator rejects malformed, unsupported, or evidence-free output.
7. Repository replaces document subgraph in one transaction.
8. Worker marks job ready and invalidates notebook graph cache.
9. Legal chat retrieves direct evidence, traverses graph, validates paths, and sends both to LLM.
10. Assistant message persists `legalReasoning` metadata for inline rendering.

## Data Model

### `legal_nodes`

Fields:

- `id`: text primary key.
- `notebookId`: owning notebook, cascade delete.
- `documentId`: source document when applicable, cascade delete.
- `chunkId`: evidence chunk for source-backed nodes, cascade delete.
- `nodeType`: `document`, `article`, `clause`, `point`, `subject`, `action`, `concept`, `sanction`, `external_reference`.
- `canonicalKey`: normalized stable key within notebook.
- `label`: display label.
- `aliases`: JSON string array.
- `articleNumber`, `clauseNumber`, `pointNumber`: optional legal coordinates.
- `startOffset`, `endOffset`: optional original-document offsets.
- `metadata`: JSON scope and temporal qualifiers.
- `createdAt`, `updatedAt`.

Constraints and indexes:

- Unique `(notebookId, nodeType, canonicalKey)`.
- Index `(documentId, nodeType)`, `(chunkId)`, and `(notebookId, label)`.

### `legal_relations`

Fields:

- `id`: text primary key.
- `notebookId`: owning notebook, cascade delete.
- `sourceNodeId`, `targetNodeId`: `legal_nodes` foreign keys, cascade delete.
- `relationType`: closed ontology predicate.
- `documentId`: extraction owner document, cascade delete.
- `evidenceChunkId`: required source chunk, cascade delete.
- `evidenceText`: bounded verbatim excerpt.
- `evidenceStartOffset`, `evidenceEndOffset`: original-document offsets.
- `confidence`: real value in `[0, 1]`.
- `qualifiers`: JSON conditions, negation, scope, temporal limits, resolver state.
- `model`, `promptVersion`, `extractorVersion`, `ontologyVersion`.
- `fingerprint`: deterministic deduplication hash.
- `createdAt`, `updatedAt`.

Constraints and indexes:

- Unique `(notebookId, fingerprint)`.
- Index `(sourceNodeId, relationType)`, `(targetNodeId, relationType)`, `(documentId)`, and `(evidenceChunkId)`.

### `legal_extraction_jobs`

Fields:

- `id`: text primary key.
- `notebookId`, `documentId`: one job per document.
- `status`: `pending`, `processing`, `retry`, `ready`, `failed`.
- `extractorVersion`, `promptVersion`, `ontologyVersion`.
- `model`: model used by last successful or attempted run.
- `attempts`, `maxAttempts`.
- `sourceUnitCount`, `processedUnitCount`.
- `leaseOwner`, `leaseExpiresAt`.
- `nextRunAt`, `startedAt`, `completedAt`.
- `lastError`: sanitized short error without source text or raw model output.
- `createdAt`, `updatedAt`.

Constraints and indexes:

- Unique `(documentId)`.
- Index `(status, nextRunAt)` and `(notebookId, status)`.

## Closed Ontology

Allowed predicates:

- `references`
- `defines`
- `applies_to`
- `requires`
- `permits`
- `prohibits`
- `exception_to`
- `condition_for`
- `sanction_for`
- `amends`
- `replaces`
- `repeals`

Validation:

- `requires`, `permits`, `prohibits` require subject and action endpoints.
- `sanction_for` connects sanction to action or source provision.
- `defines` requires source provision and concept.
- `exception_to`, `condition_for` require source-backed legal node on at least one side.
- `amends`, `replaces`, `repeals` require document/provision references and conservative applicability handling.
- Unknown predicates fail validation; no silent normalization.

## Modality Tagging

`LegalChunkContext` gains:

```ts
type LegalModality = 'obligation' | 'permission' | 'prohibition'

interface LegalModalityTag {
  type: LegalModality
  confidence: number
  evidenceText: string
  startOffset: number
  endOffset: number
}

interface LegalChunkContext {
  // existing hierarchy fields
  modalities?: LegalModalityTag[]
}
```

Rules:

- Multiple tags allowed because one chunk may contain several clauses.
- Deterministic patterns generate hints, not authoritative tags.
- Accepted `requires`, `permits`, `prohibits` relations materialize final modality tags.
- Lexical fallback stays below graph confidence gate and cannot support legal conclusion alone.
- Reindex and successful graph replacement refresh affected chunk modality metadata.

## Structured Extraction

### Input Unit

- One article-aware chunk plus document metadata and legal hierarchy context.
- Large articles use existing chunk boundaries; prompts obey configured character and timeout limits.
- Prompt includes deterministic modality and citation hints.

### AI SDK Contract

- Use `generateText` with `Output.object` and Zod schema.
- Set explicit total timeout and bounded SDK retries.
- Treat `NoObjectGeneratedError` as retryable extraction failure.
- Never accept regex-parsed prose as structured success.

### Validation Gates

Reject candidate when:

- output fails Zod schema;
- predicate is outside ontology;
- confidence is outside `[0, 1]`;
- evidence quote is empty or absent from source unit;
- evidence offsets do not map into original document;
- required subject/action/sanction endpoints are absent;
- source legal coordinates conflict with deterministic parser context;
- relation resolves to deleted or cross-notebook nodes.

### Canonicalization

- Source nodes use deterministic keys based on document ID and legal coordinate.
- Semantic labels normalize Unicode NFC, whitespace, punctuation, and Vietnamese casing.
- Aliases preserve original surface forms.
- Cross-document citations resolve by verified document number and legal coordinate.
- Missing cited documents create `external_reference` nodes with unresolved qualifiers.
- Importing or reindexing matching document triggers resolver reconciliation.

### Transaction Semantics

- Extraction builds complete in-memory candidate for one document.
- Repository writes nodes, relations, modality updates, and job success in one transaction.
- Failure before commit leaves previous successful subgraph unchanged.
- Reindex does not delete old graph until replacement candidate passes validation.

## Queue and Backfill

### Scheduling

- Concurrency: one.
- Chat has priority; worker does not claim new job while chat streams.
- Claimed jobs have lease and heartbeat.
- Expired `processing` leases become `retry` at startup.
- Backoff is exponential with fixed upper bound and persisted `nextRunAt`.
- Schema/ontology failures become `failed`; model availability/timeouts retry until `maxAttempts`.

### Backfill

- Startup scans indexed documents with detected legal structure.
- Queue job when no ready job exists for current extractor/prompt/ontology versions.
- Model changes alone do not invalidate ready graphs.
- Backfill is resumable and never blocks startup or retrieval.

### Shutdown

- Stop polling and prevent new claims.
- Active model call receives bounded completion window.
- Unfinished lease is released or expires safely.
- DB checkpoint occurs after worker shutdown attempt.

## Reasoning

### Query Intents

- direct provision lookup
- obligation
- permission
- prohibition
- sanction
- definition
- condition
- exception
- comparison
- temporal applicability

Clear legal phrases use deterministic classification. Unknown queries use general graph expansion without LLM-invented intent.

### Seed Retrieval

- Exact article/document routing remains first.
- FTS and vector search provide candidate chunks.
- Seed chunks map to source graph nodes through `chunkId` and legal coordinates.

### Traversal

- Recursive CTE supports inbound and outbound edges.
- Maximum depth: 4.
- Visited-node path prevents cycles.
- Per-query node/edge limits protect desktop runtime.
- Predicate whitelist depends on intent.
- Notebook isolation is mandatory.

### Ranking

Path score combines:

- direct seed relevance;
- relation confidence product;
- depth decay;
- evidence completeness;
- predicate relevance to intent;
- temporal applicability confidence.

Low-confidence relations appear only as limitations, never conclusion paths.

### Evidence Validation

- Every rendered step references persisted relation and source chunk.
- Every final citation belongs to retrieved or graph-expanded evidence.
- Citation validation rejects model markers outside allowed evidence.
- Missing graph path falls back to direct hybrid RAG without fabricated steps.
- Unknown effective status produces `needs_metadata`, not applicability conclusion.

## Chat Integration

`LegalReasoningResult` contains:

- `intent`
- `graphStatus`: `ready`, `pending`, `failed`, `unavailable`
- `paths`: ordered validated steps
- `evidence`: original chunk evidence
- `limitations`
- optional compatible `comparison` result

`chatHandlers` flow:

1. Run current retrieval.
2. Call `LegalReasoningService` with query and seeds.
3. Build prompt context from original evidence and validated paths.
4. Stream normal answer text.
5. Validate citations.
6. Persist `legalReasoning` and existing `legalComparison` metadata.
7. Send metadata in final stream event.

Model receives path facts but cannot add graph steps to renderer metadata.

## UI

Add `LegalReasoningPathCard` below existing model reasoning and before answer text.

- Collapsed by default.
- Header shows step count, graph status, and minimum path confidence.
- Expanded view shows provision, Vietnamese predicate label, confidence, citation button.
- Citation button reuses current Citation Inspector.
- Pending, failed, unavailable, and metadata-limited states use explicit text.
- Card never displays extractor prompts, raw model output, or chain-of-thought.

Document legal metadata UI adds graph status:

- pending: queued;
- processing: processed units / total units;
- retry: next attempt and count;
- ready: node count, relation count, versions, model provenance;
- failed: sanitized error and retry action.

## Cache

- Cache bounded adjacency lists per notebook, not complete global graph.
- Cache key includes notebook graph revision.
- Graph commit, resolver reconciliation, deletion, and reindex increment revision and invalidate notebook cache.
- Cache miss falls back to SQLite; cache is never durable state.

## Error Handling and Security

- Treat all LLM output as untrusted input.
- Enforce notebook/document ownership on repository and IPC operations.
- Do not log source excerpts, full prompts, or raw model output.
- Store only bounded evidence excerpts required for audit.
- Sanitize job errors before renderer exposure.
- Use parameterized SQLite statements for recursive queries and writes.
- Preserve current local-first provider policy; remote use remains controlled by current user settings.

## Migration and Compatibility

- Add one Drizzle migration after `0012_notebook_overview`.
- Existing documents, chunks, messages, comparison metadata, and citations remain valid.
- Existing `LegalComparisonService` exports remain available.
- New chat metadata fields are optional for old messages.
- Migration is additive; rollback removes only new graph tables/indexes.

## Testing

### Unit

- modality hints and accepted relation materialization;
- extraction schema and evidence offset validation;
- canonical keys and aliases;
- ontology endpoint constraints;
- path cycle prevention, depth bounds, predicate filters, scoring;
- citation/path validation;
- retry classification and backoff.

### Repository Integration

- migration on empty and existing DB;
- transactional document graph replacement;
- recursive inbound/outbound traversal;
- notebook isolation;
- delete/reindex cascades;
- resolver reconciliation;
- cache revision invalidation.

### Worker Integration

- indexing enqueues without blocking;
- active chat pauses new claims;
- retry survives restart;
- expired lease recovers;
- failed extraction preserves old graph;
- automatic backfill reaches ready;
- active model provenance persists.

### Chat Integration

- obligation query produces validated multi-hop path;
- sanction query reaches sanction evidence;
- missing path falls back to RAG;
- unknown temporal metadata refuses priority;
- stream and DB message contain identical reasoning metadata;
- invalid citations are rejected.

### Renderer

- card starts collapsed;
- expansion renders steps/confidence;
- citation click opens current citation flow;
- pending, failed, unavailable, limitation states render accessibly.

### Release Verification

- focused Vitest suites;
- full `pnpm test`;
- node and renderer typechecks;
- ESLint;
- production build;
- packaged smoke test;
- production dependency audit.

## Definition of Done

- New legal documents index even when graph extraction cannot run.
- Ready graph is produced asynchronously with validated evidence/provenance.
- Existing legal documents backfill automatically after upgrade.
- Obligation, permission, prohibition, definition, exception, sanction, comparison, and applicability queries can use validated graph paths.
- Reasoning paths survive restart and render inline from persisted message metadata.
- Delete/reindex leave no stale graph, job, modality, or cache state.
- All tests and release verification commands pass without unrelated changes.
