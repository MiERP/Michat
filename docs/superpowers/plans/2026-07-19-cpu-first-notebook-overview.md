# CPU-First Notebook Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-document LLM briefs with local smart chunk selection and one bounded notebook synthesis call.

**Architecture:** Pure TypeScript selects representative chunks under a fair fixed budget. NotebookOverviewService sends one grounded prompt, clamps output to 500 words, and keeps existing overview persistence/citations.

**Tech Stack:** TypeScript, SQLite/Drizzle, Vercel AI SDK, Vitest.

---

### Task 1: Lock source-selection behavior

**Files:** Modify `tests/services/notebookOverviewPrompt.test.ts`, `tests/services/notebookOverviewService.test.ts`.

- [ ] Add failing tests for fair multi-document budget, smart legal-signal selection, and one generateText call.
- [ ] Run focused tests and confirm behavioral failures.

### Task 2: Add local source selector

**Files:** Modify `src/main/services/notebookOverviewPrompt.ts`.

- [ ] Add representative chunk selection and fair source packet construction.
- [ ] Keep total source length at or below 9.000 characters.
- [ ] Run prompt tests.

### Task 3: Replace brief generation

**Files:** Modify `src/main/services/NotebookOverviewService.ts`.

- [ ] Remove document brief cache and per-document LLM calls.
- [ ] Build source packet locally and call generateText once.
- [ ] Require 300–500 words and clamp output to 500 words.
- [ ] Run service tests.

### Task 4: Remove dead persistence/UI code

**Files:** Modify `src/main/db/schema.ts`, `src/main/db/migrations/0012_notebook_overview.sql`, `src/renderer/src/components/notebook/NotebookOverviewCard.tsx`, locale files.

- [ ] Remove document_briefs schema/migration and obsolete progress label.
- [ ] Run typecheck and lint.

### Task 5: Verify

- [ ] Run focused overview tests.
- [ ] Run node/web typecheck and scoped ESLint.
- [ ] Restore Electron native dependency ABI.
