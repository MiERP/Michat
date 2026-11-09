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
| Dependency audit | `pnpm audit --prod --audit-level=high` | Exit 0; 2 low advisories documented in `docs/security/dependency-exceptions.md` |
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
| Parser isolation in a utility process (plan Task 15) | Requires a second electron-vite entry, worker lifecycle, and a packaged smoke test; file validation/size caps are already in place. | Parser RCE from a crafted document remains a High finding. Do this before accepting untrusted files from third parties. |
| `KnowledgeService` decomposition (plan Task 17) | 3.8k-line behavior-preserving split is a dedicated refactor; security/correctness changes were prioritized. | Maintainability risk only; no new runtime behavior. |
| `pnpm build:unpack` / packaged smoke | `resources/models` contains large local GGUF files; packaging would copy gigabytes. | Fuses, asar allowlist, and packaged smoke are only proven at release time. Run `pnpm check:package` / `pnpm build:unpack` plus `node scripts/check-asar.cjs <app.asar>`. |
| `pnpm lint` locally | This `node_modules` install has incomplete eslint transitive packages; CI installs from the lockfile. | Lint is verified in CI. Repair the local install before relying on local lint. |
| macOS signing/notarization | Requires Apple credentials in CI. | `mac.notarize: true` will fail without credentials; do not publish an unnotarized mac build. |
| Manual UI/security smoke | No GUI session run in this environment. | Verify paste payload, update no-auto-install, window-before-llama startup, and key redaction manually. |

## Commit range

`ab6df9f..HEAD` contains the baseline plus 21 remediation commits covering
dependencies, encoding, preload/keys/CSP/SSRF/IPC/Electron hardening, chat
streaming, prompt boundaries, startup, file import, search performance,
renderer boundary/bundle, migrations, privacy, updates, packaging, and docs.
