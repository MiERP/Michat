# Notebook Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** T?o Document Brief c? citation chunk g?c v? Notebook Overview 320 t? t?ng h?p c?c Brief, sinh th? c?ng v? b?o stale khi ngu?n ??i.

**Architecture:** SQLite l?u brief theo phi?n b?n n?i dung t?i li?u v? overview theo notebook. `NotebookOverviewService` d?ng `streamObject` v?i provider chat hi?n c?, l?c m?i chunk ID kh?ng thu?c t?i li?u/notebook tr??c khi l?u, r?i t?ng h?p overview t? Brief; citation hi?n th? lu?n ?nh x? t?i chunk ngu?n. KnowledgeService g?i `markStale` sau import, x?a v? reindex, kh?ng t? g?i LLM.

**Tech Stack:** Electron, TypeScript, Drizzle ORM SQLite, Vercel AI SDK `streamObject`, Zod, React, Zustand, Vitest.

---

### Task 1: Persist Brief and Overview

**Files:**
- Create: `src/main/db/migrations/0012_notebook_overview.sql`
- Modify: `src/main/db/schema.ts`
- Create: `src/shared/types/notebookOverview.ts`
- Test: `tests/services/notebookOverviewService.test.ts`

- [ ] **Step 1: Write failing persistence tests**

```ts
expect(service.getOverview(notebookId)).toBeNull()
service.markStale(notebookId)
expect(service.getOverview(notebookId)?.status).toBe('stale')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/services/notebookOverviewService.test.ts`
Expected: FAIL because `NotebookOverviewService` does not exist.

- [ ] **Step 3: Add migration, schema and shared contracts**

```sql
CREATE TABLE `document_briefs` (...);
CREATE TABLE `notebook_overviews` (...);
```

`DocumentBrief` keeps `documentId`, source `contentHash`, structured claims with `chunkIds`, terms, dates/numbers and questions. `NotebookOverview` keeps markdown content, source citations, `fresh|stale`, model and timestamps.

- [ ] **Step 4: Run persistence tests**

Run: `pnpm vitest run tests/services/notebookOverviewService.test.ts`
Expected: progress beyond missing-module failure.

### Task 2: Generate grounded artifacts

**Files:**
- Create: `src/main/services/NotebookOverviewService.ts`
- Modify: `src/main/services/KnowledgeService.ts`
- Test: `tests/services/notebookOverviewService.test.ts`

- [ ] **Step 1: Add failing source-grounding tests**

```ts
expect(cleanBrief.keyClaims[0].chunkIds).toEqual([ownedChunkId])
expect(overview.citations[0].chunkId).toBe(ownedChunkId)
await expect(service.generate(notebookWithNoIndexedDocs)).rejects.toThrow('No indexed documents')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/services/notebookOverviewService.test.ts`
Expected: FAIL with absent generation and citation filtering behavior.

- [ ] **Step 3: Add minimal service**

```ts
const { object } = streamObject({ model, schema, prompt })
const brief = sanitizeBrief(await object, ownedChunkIds)
const overview = sanitizeOverview(await object, notebookChunkIds)
```

Use max 320 Vietnamese words. Require `## T?ng quan notebook`, `## ?i?m ch?nh`, `## ?i?m c?n l?u ?`; preserve conflicts as notes. Reuse matching document brief only when `contentHash` matches. `markStale` only changes state.

- [ ] **Step 4: Mark overview stale after source mutations**

```ts
await this._indexContent(...)
this.notebookOverviewService?.markStale(notebookId)
```

Inject optional callback/service into `KnowledgeService`; invoke after successful add, delete and reindex. Do not regenerate automatically.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run tests/services/notebookOverviewService.test.ts tests/rag/knowledgeService.test.ts`
Expected: PASS.

### Task 3: Expose controlled IPC API

**Files:**
- Create: `src/main/ipc/notebookOverviewHandlers.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/validation.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Test: `tests/ipcValidation.test.ts`

- [ ] **Step 1: Add failing validation test**

```ts
await expect(invoke('notebook-overview:generate', { notebookId: '' })).rejects.toThrow()
```

- [ ] **Step 2: Run validation test**

Run: `pnpm vitest run tests/ipcValidation.test.ts`
Expected: FAIL until overview schemas and handlers exist.

- [ ] **Step 3: Add APIs**

```ts
window.api.notebookOverview.get(notebookId)
window.api.notebookOverview.generate(notebookId)
window.api.notebookOverview.onProgress(callback)
```

`generate` reports structured progress, returns only success/error, and uses current configured chat provider. No filesystem input or remote action beyond user-triggered LLM generation.

- [ ] **Step 4: Run IPC tests**

Run: `pnpm vitest run tests/ipcValidation.test.ts`
Expected: PASS.

### Task 4: Add compact notebook UI

**Files:**
- Create: `src/renderer/src/components/notebook/NotebookOverviewCard.tsx`
- Modify: `src/renderer/src/components/notebook/ProcessPanel.tsx`
- Modify: `src/renderer/src/locales/vi-VN/notebook.json`
- Modify: `src/renderer/src/locales/en-US/notebook.json`

- [ ] **Step 1: Add card state and manual actions**

```tsx
<NotebookOverviewCard notebookId={currentNotebookId} />
```

Fetch on notebook change. Display `T?o t?ng quan` with no artifact, `C?p nh?t t?ng quan` with existing artifact, a stale badge, generated markdown and citation markers `[n]`. Reuse `MessageItem` citation navigation pattern; never render untrusted HTML.

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck:web`
Expected: PASS.

### Task 5: Verify integration

**Files:**
- Modify: all files above only when test/build evidence requires it

- [ ] **Step 1: Run focused tests**

Run: `pnpm vitest run tests/services/notebookOverviewService.test.ts tests/rag/knowledgeService.test.ts tests/ipcValidation.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full static checks**

Run: `pnpm run typecheck && pnpm run lint`
Expected: exit code 0.

- [ ] **Step 3: Build desktop bundles**

Run: `pnpm exec electron-vite build`
Expected: exit code 0.

- [ ] **Step 4: Inspect scoped diff**

Run: `git diff --check; git diff -- src/main src/preload src/renderer/src docs/superpowers/plans tests`
Expected: no whitespace errors and only feature files plus pre-existing DOC/DOCX changes.

## Review

- Coverage: Tasks 1?2 persist structured Brief, validate original chunk citations, stale sources and manual-only generation. Task 3 exposes safe IPC. Task 4 creates card. Task 5 verifies tests, type checks, lint and build.
- Placeholder scan: no `TODO`, `TBD`, or undefined later-step contracts.
- Type consistency: shared types define `DocumentBrief`, `NotebookOverview`, and citation records before service, IPC and UI use them.
