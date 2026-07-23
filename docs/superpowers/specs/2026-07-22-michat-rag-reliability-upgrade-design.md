# MiChat RAG Reliability Upgrade Design

## Goal

Fix ten observed failures across legal graph extraction, routing, citations, deduplication, overview coverage, metadata, answer completeness, UI state, and token telemetry without adding dependencies or replacing existing SQLite RAG infrastructure.

## Invariants

- Direct single-work lookup uses retrieved evidence without legal graph activation.
- Legal graph core never depends on an LLM provider.
- Every persisted citation must be used by final answer and belong to current message.
- Every legal relation must carry source evidence from indexed content.
- Physical source files remain visible; equivalent legal works are grouped canonically.
- Provider/schema errors stay in logs and DB diagnostics, not user-facing answer UI.
- Existing user changes and indexed source files remain intact.

## Architecture

### Canonical legal works

Derive `canonicalLegalWorkKey` from validated `documentType`, complete `documentNumber`, and issuer when available. Store key and duplicate-group metadata inside existing `documents.metadata`; avoid schema migration for desktop-scale notebooks. Exact content hashes detect identical content. Canonical legal-work grouping detects DOCX/PDF variants of same promulgated instrument.

Retrieval keeps physical chunks, then collapses equivalent results by canonical work and legal coordinates. Comparison groups evidence by canonical work, preventing duplicate variants from becoming separate legal authorities. Overview allocates budget by canonical work, not physical file.

### Deterministic graph core

Replace mandatory LLM-per-chunk extraction with two deterministic passes:

1. Document pass creates document/article/clause/point nodes from existing `legalStructure` and chunk `legalContext`, plus evidence-backed internal references and declared amendment/replacement/repeal relations.
2. Notebook linker resolves external document numbers against canonical legal works and links available target nodes. Unresolved targets remain `external_reference` nodes.

Do not add `contains`; hierarchy remains encoded by article/clause/point coordinates. Graph jobs count articles as source units. Core graph becomes ready before optional enrichment. Optional enrichment may add semantic relations but cannot overwrite core job status or provider error state.

Reasoning seeds map by canonical work and legal coordinates, not exact `chunkId`. Activation requires relational intent and at least two distinct canonical legal works. Same-law DOCX/PDF variants count as one work.

### Routing and retrieval contracts

Normalize Vietnamese queries with NFC, lowercase, whitespace collapse, and a diacritic-folded companion string. Route social/assistant requests away from RAG. Mixed-intent queries retain knowledge intent when a real document question remains.

After rerank, apply score-type-aware relevance gates. If no evidence survives, answer without RAG citations. Retrieval candidates may exist internally, but final message metadata stores only citations actually used by final answer.

Legal article lookup expands all chunks belonging to requested article and requested clause/point span before applying context limits. Final answer completeness checks requested legal coordinates and removes unsupported references.

### Citation contract

Use current-message citation namespace only. Prompt source blocks remain machine-readable, but finalizer removes raw `<doc ...>` tags, invalid `[n]` markers, and inherited markers from earlier turns. Persist metadata only for citation IDs present in sanitized final content. Insufficient-evidence answers persist no citations.

### Overview coverage

Select sources by canonical work. Reserve budget for every distinct work before ranking additional chunks. Require source markers in generated overview, sanitize them, and persist matching citation metadata. Coverage validator regenerates once when a legal work receives no representation; otherwise returns explicit limitation rather than silently omitting it.

### Metadata and telemetry

Replace document-number word-boundary termination with explicit Unicode-safe token termination. Confidence is high only when full token validation passes. Canonical key generation refuses truncated legal numbers.

Normalize AI SDK usage fields. When provider usage is missing or all zero, estimate prompt/completion tokens and persist estimated usage with `estimated: true`. Session accounting and message metadata use same normalized usage object.

### UI state

Render legal reasoning card only when reasoning was activated. Read latest graph status from DB-backed store. Failed state shows stable user-safe message and retry action; raw provider/schema error stays in diagnostics. Shutdown cancellation releases leases and never replaces an existing provider failure with shutdown text.

## Acceptance

- Four target legal documents build deterministic core graphs with non-zero processed units and no provider request.
- Single-document lookup and same-law duplicate comparison show no reasoning path card.
- Cross-work relational query shows verified graph path only when evidence spans two canonical works.
- No raw `<doc>` tags or orphan citation markers appear.
- Message DB citations equal citation markers in final answer.
- Overview cites and covers all distinct canonical works, including `103/2025/NĐ-CP`.
- Both `07/2022/QH15` files remain visible but comparison treats them as one work.
- Requested article/clause/point answers include all retrieved requested units or state missing evidence.
- Token telemetry is positive and marked estimated when provider reports zero.
- Targeted tests, full tests, typechecks, lint, build, and real Electron UI flow pass.
