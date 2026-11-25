# Changelog

All notable changes to MiChat are documented in this file.

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
