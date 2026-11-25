# Changelog

All notable changes to MiChat are documented in this file.

## [2.2.0] - 2026-11-25

### Added

- Legal-aware section detection for Vietnamese legal documents: `Chương`, `Mục`, and `Điều`
  headings are recognized even when they use the same font size as body text. Re-indexing a legal
  PDF/plain-text document now creates sections and enables document → section → chunk retrieval.
- Article-number boost: questions that name `Điều N` retrieve a wider candidate pool and put
  matching sections first.
- Flat + hierarchical retrieval merge: the section tier can no longer hide an exact definition
  chunk that lives outside the selected sections.
- Definition-question handling: wider candidate pool, no section de-duplication, and separate
  chunks for definitions that share one large section (for example `10b` and `10c` of the IP law).

### Changed

- Merge persona, long-term memory, and RAG context into a single leading system message. This
  fixes empty answers and HTTP 500 responses from llama.cpp/Qwen chat templates that reject
  multiple system messages.
- Default RAG settings: `ragTopK=5`, `ragThreshold=0.5`, heuristic rerank disabled.
- RAG context budget: 4,000 tokens total, 1,400 tokens per document.
- Chat generation: temperature `0.2`, output cap `1,400` tokens, and instructions for concise
  answers, exact clause labels, verbatim definitions, and minimal citations.
- Stale-stream timeout raised from 5 to 10 minutes so long legal answers are not aborted.

### Fixed

- Assistant messages no longer stay empty when the llama.cpp/Qwen chat template rejects the
  request because it contains multiple system messages.
- Long answers (more than five minutes) no longer fail during generation.

## [2.1.0] - 2026-11-25

### Changed

- Show the installed version and the latest release version beside the update-check button; localize update status and point project links at MiERP/Michat.

## [2.0.1] - 2026-11-24

### Changed

- Relicensed MiChat under AGPL-3.0-only and updated license links/metadata.

## [2.0.0] - 2026-11-24

### Changed

- Replaced the bundled llama.cpp runtime, provider registry, and model management with a single configurable external local OpenAI-compatible API. MiChat now only configures, tests, and uses the API from Settings > API.

## [1.1.1] - 2026-11-24

### Changed

- Release hardening: CI packaging smoke, asar validation, CJK/encoding gates, and Windows E2E onboarding smoke.
- Split `KnowledgeService` into focused RAG modules and reconstructed the missing Drizzle snapshots.
- Removed the hardcoded informational license service and dead provider/image-generation code.
- Completed `vi-VN` translations, removed all Chinese comments/strings, and eliminated lint warnings.
- Branded the app and installer with the MiChat icon and fixed the Vietnamese product description.
