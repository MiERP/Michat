# MiChat RAG Reliability Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legal RAG deterministic, citation-safe, canonical-work aware, complete, observable, and verified through real Electron UI.

**Architecture:** Reuse existing parser, SQLite graph repository, RAG search, and renderer. Add small pure helpers for canonical identity, citation finalization, deterministic graph extraction, coverage selection, and usage normalization. No dependency or graph schema change.

**Tech Stack:** TypeScript, Electron, React, Drizzle, SQLite, AI SDK v5, Vitest, Playwright.

---

### Task 1: Canonical metadata and deduplication

- [ ] Add failing tests for complete legal numbers, canonical grouping, and same-work comparison.
- [ ] Add Unicode-safe document-number validation and canonical legal-work helper.
- [ ] Persist canonical key and duplicate-group metadata after extraction.
- [ ] Collapse retrieval/comparison duplicates without deleting physical sources.
- [ ] Run focused metadata, comparison, and knowledge tests.

### Task 2: Deterministic graph core

- [ ] Add failing tests proving core extraction needs no model and emits structural/reference relations.
- [ ] Replace per-chunk model calls with deterministic document pass.
- [ ] Resolve notebook external references by canonical work where available.
- [ ] Seed reasoning by legal coordinates and canonical graph document.
- [ ] Make optional enrichment non-blocking and preserve core failure state.
- [ ] Run focused graph tests.

### Task 3: Routing, relevance, citation contract, completeness

- [ ] Add failing tests for Vietnamese normalization, mixed intent, single-work graph suppression, raw tag stripping, current-message citations, empty-evidence metadata, and requested clause coverage.
- [ ] Add pure routing and finalization helpers.
- [ ] Apply relevance gate before citation construction.
- [ ] Persist only citation markers surviving final answer sanitization.
- [ ] Expand article retrieval by legal coordinates before top-K clipping.
- [ ] Run focused chat and retrieval tests.

### Task 4: Overview, telemetry, and safe UI state

- [ ] Add failing tests for canonical-work overview coverage, overview citations, positive estimated usage, hidden raw errors, and no card without activation.
- [ ] Allocate overview budget per canonical work and persist used citations.
- [ ] Normalize provider usage and persist estimation fallback.
- [ ] Render live safe failure state without raw provider/schema text.
- [ ] Keep shutdown cleanup from overwriting stored provider failure.
- [ ] Run focused overview, provider, and renderer tests.

### Task 5: Automated verification

- [ ] Run all focused test files from Tasks 1-4.
- [ ] Run `pnpm run test:rag`, `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`.
- [ ] Run `git diff --check` and review complete diff without fixing unrelated failures.

### Task 6: Real Electron UI evaluation

- [ ] Start `pnpm dev` and wait for Electron renderer readiness.
- [ ] Use existing four indexed documents and rebuild graph through UI when required.
- [ ] Test single-document lookup, same-law comparison, cross-work relation, mixed intent, insufficient evidence, article/clause completeness, and notebook overview.
- [ ] Capture answer text, citations, reasoning-card state, overview, graph status, token metadata, screenshots, console errors, and DB rows under `%TEMP%\michat-rag-upgrade-e2e`.
- [ ] Compare results against acceptance criteria and write final evaluation report.

## Self-Review

- [x] Every listed production failure maps to at least one task and acceptance check.
- [x] No dependency or mandatory DB migration added.
- [x] Deterministic graph core remains usable without provider.
- [x] Duplicate physical files remain visible.
- [x] UI test uses real indexed data and records artifacts outside repository.
