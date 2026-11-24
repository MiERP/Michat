# Release hardening — 2026-11-24

Scope: P0–P2 remediation from the 2026-11-24 audit, removal of Chinese (CJK)
text from the source tree, and Windows app/installer branding.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | 0 errors, 0 warnings (`--max-warnings 0`) |
| `pnpm test` | 45 files, 239 tests passed |
| `pnpm test:coverage` | statements 46.34%, branches 40.76%, functions 44.36%, lines 47.29% (thresholds 42/35/40/42) |
| `pnpm test:e2e` | Playwright Electron onboarding smoke passed |
| `pnpm check:cjk` | Clean (376 text files) |
| `pnpm check:encoding` | Clean |
| `pnpm check:migrations` | 21/21 journal entries have snapshots |
| `drizzle-kit generate` | “No schema changes, nothing to migrate” |
| `pnpm check:deps` | Pass |
| `pnpm audit --prod --audit-level=high` | No known vulnerabilities |
| `pnpm package:ci` / `check-asar` | Pass; no source/test/docs/coverage files in asar |

## Packaging

- `pnpm build:win:slim` produces a model-less NSIS installer:
  `dist/michat-1.1.1-slim-setup.exe` (214,752,181 bytes, SHA-256
  `6F8614665402EB185A0CE2373287E9CDA6954B217D4A4CE3E9368D772033054E`).
- The app and installer both use the MiChat "Mi" icon; the packaged
  `michat.exe` reports product `MiChat`, version `1.1.1`, company `HAVS`, and
  the installer carries the corrected Vietnamese product description.
- Packaged renderer was verified over CDP: onboarding renders with
  `H1 = MiChat` and the localized start button.
- GGUF models are not bundled; `resources/models/` is shipped for post-install
  model copies. The strict `pnpm build:win` path still requires models.

## Changes

- CI: Windows packaging smoke, asar check, Playwright E2E, and CJK gate.
- Packaging: standalone slim config (models excluded, llama runtime kept),
  `.tsbuildinfo` exclusion, resedit-based icon/version branding in `afterPack`.
- Knowledge: `KnowledgeService` reduced from 3,432 to 460 lines and split into
  retrieval, ingestion, indexing, maintenance, document, auto-sync, types,
  embedding-runtime, and file-store modules.
- Llama runtime: packaged builds resolve resources from the app directory
  (not `cwd`); model imports copy asynchronously.
- i18n: complete `vi-VN` key parity (171 missing keys added), parity test,
  localized onboarding with missing-model notice; unused duplicate i18n module
  removed.
- Providers: removed unused cloud-provider SDKs and the dead image-generation
  capability; llama-only surface matches policy.
- Text hygiene: all Chinese comments/strings translated to English, including
  migrations; functional fullwidth punctuation kept as Unicode escapes;
  broadened mojibake detection.
- Database: reconstructed snapshots `0003` and `0012`–`0019`, linked the
  snapshot chain, restored two indexes in `schema.ts`, and verified with
  `drizzle-kit generate`.
- License: removed the hardcoded informational license service, IPC API, and UI
  gating (it never blocked a request in practice).
- Types: eliminated all `@typescript-eslint/no-explicit-any` warnings in `src`
  and `tests`; lint now enforces zero warnings.
- Dependencies: i18next upgraded to 26.7.2 (GHSA-6jcc-5g8w-32mx) with a floor.

## Notes

- Slim installers are unsigned; Windows SmartScreen may warn. Signed release
  builds use `electron-builder.yml` with `CSC_LINK`/`CSC_KEY_PASSWORD`.
- The renderer entry chunk remains above Vite's 500 kB advisory. A vendor-chunk
  experiment caused a React initialization cycle and was reverted; keep the
  current chunking until it can be split with a verified runtime test.
- macOS/Linux packaging and signing still require their respective CI
  credentials and have not been smoke-tested here.


## API-only follow-up (worktree `feature/api-only`)

MiChat no longer contains a provider registry, llama.cpp runtime, model
selection, or model import/removal. It now configures one external local
OpenAI-compatible API.

- Removed `src/main/providers/`, `LlamaService`, `services/llama/`,
  llama/provider IPC handlers, preload APIs, model settings UI, bundled
  `resources/llama-bin` and `resources/models`, and runtime-asset build
  checks.
- Added `src/main/ai/` (`ApiConfigManager`, `ApiClient`,
  `OpenAICompatibleClient`) and `api:*` IPC channels.
- New Settings → API page: loopback base URL, encrypted API key, chat model,
  embedding model, context window, test connection, save.
- Playwright E2E now starts a fake local API, saves the config through the UI,
  tests the connection, and verifies the persisted public config.

Latest verification:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | 0 errors, 0 warnings |
| `pnpm test` | 43 files, 232 tests passed |
| `pnpm test:e2e` | Pass (API configuration flow) |
| `pnpm check:cjk` / `check:encoding` | Clean |
| `pnpm build:win` | Pass; no llama/model assets in the package |
| Packaged renderer (CDP) | Onboarding renders, app boots without any model runtime |

Installer: `dist/michat-2.0.0-setup.exe`, 167,790,931 bytes, SHA-256
`5868872D80F21433AAA0B2DEC4C56A0A93A22FA1454D82609828F23BC47CC4AE`.
Version 2.0.0 is managed by `scripts/version.cjs`; see `docs/versioning.md`.
