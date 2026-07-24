# Flattened PDF Metadata Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all six metadata fields when PDF text has no line breaks.

**Architecture:** Keep current line-based extraction for structured documents. Add deterministic header-text fallbacks with precise evidence offsets for flattened PDF text; never call external AI and never alter chunking.

**Tech Stack:** TypeScript, Vitest, Electron/Vite

---

### Task 1: Reproduce flattened header

**Files:**

- Test: `tests/rag/documentMetadataExtractionService.test.ts`

- [ ] Add a test using the flattened `38/2024/QH15` header.
- [ ] Assert type `Luật`, issuer `Quốc hội`, title, and legal basis.
- [ ] Run `pnpm exec vitest run tests/rag/documentMetadataExtractionService.test.ts` and confirm failure.

### Task 2: Add scoped fallbacks

**Files:**

- Modify: `src/main/services/DocumentMetadataExtractionService.ts`

- [ ] Find earliest document-type token in header text.
- [ ] Find canonical or leading organization issuer without line breaks.
- [ ] Extract title between issue date/type and first `Căn cứ` clause.
- [ ] Collect only semicolon-terminated `Căn cứ...` clauses.
- [ ] Preserve existing line-based behavior and evidence offsets.

### Task 3: Verify

**Files:**

- Test: `tests/rag/documentMetadataExtractionService.test.ts`

- [ ] Run focused metadata tests.
- [ ] Run `pnpm run typecheck`.
- [ ] Review diff; do not commit without user approval.
