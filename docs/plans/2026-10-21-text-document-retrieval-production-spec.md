# Spec: Production structured retrieval for text documents

## Objective

Complete the remaining production gaps in the structured Markdown and metadata-aware retrieval pipeline for local text documents. The acceptance contract is the ingest/retrieval flow in `docs/New folder/mermaid-diagram.png`, excluding Web ingestion by user decision.

Every supported source must follow one canonical path: loader -> canonical Markdown -> structure and document metadata -> document/section/chunk indexes -> metadata-aware hierarchical retrieval -> RRF/rerank -> section-aware context -> citation.

Supported source families are Markdown/TXT, DOCX, text PDF, scanned PDF with optional local OCR, XLSX, and PPTX. A source that cannot be parsed must end in a recoverable failed state with an actionable reason; it must not leave orphaned index records.

## Commands

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; .\node_modules\.bin\electron.cmd .\node_modules\vitest\vitest.mjs run
pnpm run typecheck
pnpm run lint
pnpm run build
```

## Project structure

- `src/main/services/loaders/` owns source-specific extraction.
- `src/main/services/MarkdownNormalizer.ts` owns canonical Markdown and stable offsets.
- `src/main/services/KnowledgeService.ts` owns index lifecycle and retrieval orchestration.
- `src/main/services/DocumentMetadataIndexService.ts` owns metadata projection.
- `src/main/db/` owns schemas and migrations.
- `tests/rag/` owns deterministic integration tests with fake embeddings.
- `tests/evals/` owns acceptance evaluation scenarios.

## Code style

Use explicit typed contracts at pipeline boundaries and persist source metadata with each chunk.

```ts
const normalized = this.markdownNormalizer.normalize(parseResult)
const structure = this.buildChunkStructureContext(normalized.structure)
await this.indexCanonicalDocument(documentId, normalized.content, structure)
```

No loader may update FTS/vector tables directly. A loader returns a `DocumentLoadResult`; the common indexing path persists canonical content and all derived indexes.

## Testing strategy

- Unit tests: extraction/normalization, metadata normalization, reconciliation decisions.
- Integration tests: ingest each supported source, assert document/section/chunk/FTS/vector invariants, then query and assert citations remain scoped.
- Failure tests: interrupted index state, OCR failure, stale vectors, deleted/reindexed documents.
- Evaluation tests: exact metadata, ambiguous metadata, sheet/row, slide, page and long-document entity cases.

## Boundaries

- Always: preserve local-first storage, keep user scope hard, run the relevant regression suite after each slice, and preserve citations to original location.
- Ask first: add a new production dependency, send document content to a remote OCR service, alter retention semantics, or remove existing source support.
- Never: make inferred metadata a hard constraint unless a unique resolution proves it, write source content to telemetry, or leave an index partially committed without reconciliation.

## Success criteria

1. Canonical Markdown and source structure are stored for every successful supported ingest.
2. PDF pages, XLSX sheets/rows and PPTX slides become retrievable structural scopes and citation locations.
3. OCR is local, opt-in, observable and produces page-scoped text/evidence; unavailable OCR produces a clear failed/degraded state.
4. Index reconciliation repairs interrupted or stale document/section/chunk/FTS/vector state idempotently.
5. Section retrieval degrades per document, not for the entire notebook.
6. Metadata planning queries indexed relational values directly and invalidates correctly after update/reindex/delete.
7. Enrichment covers the whole document through bounded section/chunk aggregation and retains evidence.
8. Every acceptance scenario exercises the diagram from ingest to cited answer context without escaping a hard user scope.

## Implementation slices

1. Define persistent index-health/reconciliation contract and repair incomplete state.
2. Make section coverage and hierarchical selection document-scoped.
3. Make metadata lookup indexed and standardize old migration values.
4. Add structured XLSX sheet/row and PPTX slide section output and citation metadata.
5. Add local OCR adapter contract, PDF fallback, page evidence and failure policy.
6. Upgrade DOCX table canonicalization and fidelity tests.
7. Replace first-3,000-character enrichment with bounded section aggregation and evidence projection.
8. Add end-to-end evaluation fixtures and release gates.

## Open constraint resolved by user

Web ingestion/browser rendering is outside this work. Existing URL support remains untouched; no Web-specific expansion is part of the acceptance criteria.
