# Remediation Verification — 2026-11-09

Branch: `Michat-0.1.5`
Baseline: `ab6df9f` (working tree snapshot before remediation)
Verification commit: this document

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript (main + renderer) | `pnpm typecheck` | Pass |
| Unit/integration tests | `pnpm test` | 42 files, 205 tests passed |
| Production build | `pnpm build` | Pass; renderer entry ~2.08 MB, lazy KaTeX/editor/highlight/QuizPage chunks |
| Dependency audit | `pnpm audit --prod --audit-level=high` | Exit 0; the 2 low advisories originally documented in `docs/security/dependency-exceptions.md` were fixed on the same day (`@ai-sdk/provider-utils` 3.0.45, `katex` 0.19.1) and now have dependency floors |
| Dependency floors | `node scripts/check-dependency-floor.cjs` | Pass |
| Encoding | `node scripts/check-encoding.cjs` | Pass (0 mojibake lines) |
| Migration snapshots | `node scripts/check-migrations.cjs` | Pass (21 journal entries) |
| IPC validation coverage | `tests/ipcValidationCoverage.test.ts` | Pass |
| Renderer/main boundary | `tests/architecture/rendererImports.test.ts` | Pass |

## Security fixes verified by tests

- Raw `window.electron.ipcRenderer` removed; curated `window.api` only; context-isolation fail-closed (`tests/preloadSurface.test.ts`).
- Provider API keys never returned to renderer; redacted saves preserve the key (`tests/providerSecrets.test.ts`).
- Pasted HTML sanitized against event handlers, `javascript:` URLs, and embedded elements (`tests/renderer/pasteSanitizer.test.ts`).
- CSP production policy restricts connections to self (`tests/security/csp.test.ts`).
- SSRF: IPv4-mapped IPv6, unspecified, multicast, reserved, loopback, link-local rejections; bounded response bodies (`tests/guards.test.ts`, `tests/webFetchHardening.test.ts`).
- Electron webPreferences flags and no preload fallback (`tests/security/webPreferences.test.ts`).
- Chat preflight errors return a deterministic result without a stuck stream (`tests/renderer/chatStore.test.ts`).
- Prompt boundaries: fake document/role/chat-template tokens stripped (`tests/rag/promptBoundary.test.ts`).
- File import: size/extension/magic-byte/symlink validation (`tests/import/fileValidation.test.ts`).
- Secure deletion pragmas and foreign keys (`tests/databaseLifecycle.test.ts`).
- Update download does not auto-install; explicit install required (`tests/updateService.test.ts`).

## Deferred / not executed

| Item | Why | Risk / next step |
| --- | --- | --- |
| `pnpm build:unpack` / packaged release smoke | Two blockers: `resources/models` contains large local GGUF files (packaging would copy gigabytes), and `@electron/asar` cannot load with the current overrides. | The asar tooling break is a repo-level defect, not just a local install issue: `pnpm-workspace.yaml` pins `brace-expansion@>=2` to `2.1.7`, but `minimatch@10.2.5` (used by `@electron/asar`) imports the v4 named export `expand`, so `node scripts/check-asar.cjs` and `electron-builder` fail with `does not provide an export named 'expand'`. Fix the override (scope it to the v2 consumers, or allow `brace-expansion@>=4`) and regenerate the lockfile before relying on `check:package`. Once that and the GGUF size issue are resolved, `pnpm check:package` now runs `smoke:parser-worker`, `check-asar` on `dist/win-unpacked/resources/app.asar`, the packaged parser smoke and the onboarding smoke. |
| macOS signing/notarization | Requires Apple credentials in CI. | `mac.notarize: true` will fail without credentials; do not publish an unnotarized mac build. |
| Manual UI/security smoke | No GUI session run in this environment. | Verify paste payload, update no-auto-install, window-before-llama startup, and key redaction manually. |

## Follow-up remediation (same day)

| Item | State | Evidence |
| --- | --- | --- |
| Parser isolation in a utility process (plan Task 15) | **Done.** All document loaders run in `out/main/parserWorker.js` via `utilityProcess.fork`. The worker re-validates size/type in its own process, parses have a timeout that kills a stuck worker, exits reject all in-flight requests, and repeated crashes disable parsing for the session instead of degrading to in-process parsing. | `tests/import/parserWorker.test.ts` (protocol, timeout, crash/restart limits, disposal); `node scripts/smoke-parser-worker.cjs` on the built bundle (Markdown + real PDF + unsupported file); `electron . --smoke-parser=<file>` printed `MICHAT_PARSER_SMOKE_OK chars=451 mime=text/markdown pid=10188` with a PID different from the main process. |
| `KnowledgeService` decomposition (plan Task 17) | **Partially done.** The metadata/retrieval-text builders and the section index lifecycle moved to `src/main/services/rag/DocumentRetrievalMetadata.ts` and `src/main/services/rag/SectionIndexService.ts` (3867 → 3489 lines) with no behavior change. The retrieval pipeline (`search`, `searchMetadataAware`) and the document lifecycle (`reindexDocumentIncremental`, auto-sync/watcher) are still in `KnowledgeService`. | `pnpm typecheck`, `pnpm test` (43 files / 214 tests), `pnpm lint` all pass after the split. |
| `pnpm check:security` (re-run after the parser work) | **Pass: `pnpm audit --prod` reports no known vulnerabilities.** Both low advisories were fixed inside their existing major lines: `@ai-sdk/provider-utils@3.0.45` (GHSA-866g-f22w-33x8, was 3.0.19) via `ai@5.0.286` + `@ai-sdk/{openai,openai-compatible,deepseek}` updates and a 3.x-scoped override for `ollama-ai-provider-v2`, and `katex@0.19.1` (GHSA-238p-pmpm-9mq7, was 0.16.27) forced through `rehype-katex`/`remark-math` by override. `qwen-ai-provider` moved 0.1.1 → 1.0.0 (the line built on the AI SDK 5 provider spec), the unused `ollama-ai-provider` v1 dependency was removed, and both packages now have floors in `scripts/check-dependency-floor.cjs`. That script also ignores virtual-store dirs that are no longer listed in the installed `node_modules/.pnpm/lock.yaml`, so a stale store entry cannot fail the release check. | **Evidence:** every provider (`qwen`, `ollama`, `openai`, `openai-compatible`, `deepseek`) still reports `specificationVersion: 'v2'` at runtime (required by `ai@5`), so no cross-spec breakage; a `rehype-katex` + KaTeX 0.19 render of inline/display math succeeds and `\href{javascript:...}` emits no `href`; `check:deps` passes; 23 guard/IPC/provider-policy tests pass. |
| `pnpm lint` locally | **Fixed.** The install had 19 empty ESLint-toolchain package directories (`@eslint/eslintrc`, `@typescript-eslint/*`, `eslint-plugin-*`, `typescript-eslint`, `@electron-toolkit/eslint-config-*`) plus a missing `debug@4.4.3` and `@eslint-community/eslint-utils`; they were restored at the lockfile versions. Two pre-existing lint errors (`Function` type in `WebFetchService`, `require()` in `tests/updateService.test.ts`) were also fixed. | `pnpm lint` → exit 0, 0 errors, 477 pre-existing warnings. |

## Commit range

`ab6df9f..HEAD` contains the baseline plus 21 remediation commits covering
dependencies, encoding, preload/keys/CSP/SSRF/IPC/Electron hardening, chat
streaming, prompt boundaries, startup, file import, search performance,
renderer boundary/bundle, migrations, privacy, updates, packaging, and docs.
