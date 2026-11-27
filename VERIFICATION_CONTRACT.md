# VERIFICATION CONTRACT — MiChat 2.2.4 update-feed fix

Every criterion is verified by an independent `desktop-verifier` using Playwright Electron CDP.
No OS mouse, keyboard, or screen capture is used. Each launch gets a fresh temp
`--user-data-dir`, `MICHAT_E2E_OFFSCREEN=1`, and `NODE_ENV=production`; the update E2E writes a
temporary `dev-app-update.yml`, then restores the original file.

**Run directory:** `.opencode/evidence/<run-id>/`

**Pre-flight before the repository is made public**

- Run a full-history secret scan:
  `git grep -n -I -E 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----' $(git rev-list --all)`
  and confirm no matches.
- Confirm no token in `dev-app-update.yml`, `electron-builder.yml`, `out/`, or `app.asar`.
- Record the maintainer approval to make the repository public in `report.md`.
- Then set `MiERP/Michat` public and record `gh repo view MiERP/Michat --json isPrivate` = `false`.

**Global checks**

| Check                         | Command                                                                                                            | Pass condition                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Full tests                    | `pnpm test`                                                                                                        | exit 0                                                                   |
| Lint/typecheck                | `pnpm lint`, `pnpm typecheck`                                                                                      | exit 0                                                                   |
| Version                       | `pnpm check:version`                                                                                               | 2.2.4 consistent                                                         |
| Installer                     | `pnpm build:win`                                                                                                   | 2.2.4 installer + blockmap + latest.yml                                  |
| Packaged smoke                | `powershell -ExecutionPolicy Bypass -File scripts/smoke-packaged.ps1 -ScreenshotPath <run>/ac-06-packaged-app.png` | parser OK, packaged version 2.2.4, screenshot written                    |
| Anonymous atom/API/latest.yml | `curl -i` / `curl -L`                                                                                              | HTTP 200; or `NETWORK_UNAVAILABLE` if `MICHAT_REQUIRE_GITHUB` is not `1` |

---

## AC-01 — Local feed check reaches NOT_AVAILABLE

**Given:** A temporary `dev-app-update.yml` points a `generic` provider at a local HTTP server.
The server returns a valid `latest.yml` with `version: 2.2.3`; the app under test is 2.2.4.
`forceDevUpdateConfig` is active because the app is unpackaged.

**User action:** Open Settings → About, click **Check for Updates**.

**Expected UI & deterministic reaction:** The status reads "You are on the latest version" /
"Bạn đang dùng bản mới nhất". `window.api.update.getState()` is `NOT_AVAILABLE` with no
`errorKind` and no `error`. The local server received `GET /latest.yml` and returned 200. No
renderer `console.error`/`pageerror`.

**Screenshot:** `ac-01-update-check-success.png`.

**Isolated method:** Playwright Electron CDP; local loopback HTTP fixture; no GitHub dependency.

---

## AC-02 — 404/private feed error is friendly, sanitized, and leak-free

**Given:** The local feed returns HTTP 404 for `/latest.yml` with
`Set-Cookie: _gh_sess=fake-session`, `Content-Security-Policy: default-src 'none'`, and a body
containing `releases.atom` and `Headers: { ... }`. Two exact raw updater error fixtures are
committed: `tests/fixtures/update/private-feed-error.txt` and
`tests/fixtures/update/header-first-error.txt` (first line is a header/cookie block). About is
open.

**User action:** Click **Check for Updates**.

**Expected UI & deterministic reaction:** The harness first records that the local 404 response
contains `_gh_sess`, `set-cookie`, `content-security-policy`, and `releases.atom`, and the mocked
`UpdateService` unit test records that the **raw updater rejection** passed to the sanitizer
contains all target tokens. The card then shows the localized `feed-unavailable` message. None of
those tokens is visible in the DOM or in any native dialog (Playwright `dialog` listener). The
update state contains `errorKind: 'feed-unavailable'` and **no free-text error field**; every
update IPC handler returns only the fixed code `update-failed`. Sanitized detail remains in the
main-process log. The header-first and multi-line header fixtures drop the header block and keep
the next safe line (or return `''` if none remains).

**Screenshot:** `ac-02-update-error-friendly.png`.

**Isolated method:** Playwright Electron CDP click against the local 404 feed; dialog listener;
unit tests.

---

## AC-03 — Network, unknown, and download failures use localized messages

**Given:** Three local-feed variants: a closed loopback port (network), an HTTP 500 check with a
non-feed body (unknown), and a valid `latest.yml` advertising v2.2.5 whose installer URL returns
HTTP 500 (download failure).

**User action:** For the first two variants, launch, open Settings → About, click **Check for
Updates**. For the download variant, click Check (state becomes AVAILABLE), then click **Download
Update**.

**Expected UI & deterministic reaction:** The card shows the exact locale strings from SPEC §2:
`updateErrorNetwork` for the closed port, `updateErrorUnknown` for the 500 check, and
`updateErrorUnknown` for the failed download (500 installer). None shows raw headers/cookies, and
none opens a raw native dialog. State objects carry the matching `errorKind`; `update:download`
returns `success: false` with the fixed `update-failed` code only; state carries the matching
`errorKind`. Install failure is covered by the mocked `UpdateService` unit test and sets `ERROR`
with a categorized state; sanitized detail remains in main-process logs. Both locale files
contain all three `updateError*` keys with the exact English/Vietnamese values. No console errors.

**Screenshots:** `ac-03-network-error.png`, `ac-03-unknown-error.png`,
`ac-03-download-error.png`, `ac-03-download-network-error.png`.

**Isolated method:** Playwright Electron CDP; local loopback fixtures; dialog listener.

---

## AC-04 — Silent startup, restart reset, and manual/startup overlap

**Given:** A 404 feed is configured before launch. A `window.api.update.onStateChanged` collector is
attached immediately after `firstWindow()`, before the 5-second startup timer fires.

**User action:** Launch, wait more than 6 seconds, then open Settings → About without clicking
Check. Then perform one manual check, close the app, relaunch with the same 404 feed, wait more
than 6 seconds again, and open About.

**Expected UI & deterministic reaction:** After each startup wait, About is `IDLE` with no error
text and the state collector is empty (no `CHECKING`, no `ERROR`); the captured app stderr contains
the sanitized warning summary but none of the forbidden tokens. After the manual check the state is
`ERROR`. After relaunch and the second >6s wait, About is `IDLE` again with no stale error. A
mocked `UpdateService` unit test also covers a manual click overlapping an in-flight silent check:
the manual call waits, runs a fresh non-silent check, and surfaces the error instead of inheriting
the silent flag.

**Screenshots:** `ac-04-silent-startup.png`, `ac-04-restart-reset.png`.

**Isolated method:** Playwright Electron CDP; local 404 feed; pre-armed preload listener; captured
`app.process().stderr`; mocked unit test.

---

## AC-05 — Version, changelog, README, and About show 2.2.4

**Given:** The final 2.2.4 tree is built.

**User action:** Open Settings → About.

**Expected UI & deterministic reaction:** About shows `v2.2.4`. `package.json` is `2.2.4`,
`CHANGELOG.md` contains `## [2.2.4] - 2026-11-27`, README contains `### What's new in 2.2.4` and
explains the public feed + friendly errors, and `pnpm check:version` passes.

**Screenshot:** `ac-05-about-version.png`.

**Isolated method:** Playwright Electron About screenshot plus shell/file assertions.

---

## AC-06 — Windows 2.2.4 artifacts and packaged app

**Given:** `pnpm build:win` completed from the final tree.

**User action:** Launch the packaged app offscreen through the packaged smoke's CDP port.

**Expected UI & deterministic reaction:** `dist/michat-2.2.4-setup.exe` (>50 MB),
`dist/michat-2.2.4-setup.exe.blockmap`, and `dist/latest.yml` with `version: 2.2.4` exist.
`pnpm smoke:packaged` prints `MICHAT_PARSER_SMOKE_OK` and `[version] packaged app reports 2.2.4`.
ASAR contains no source/tests/docs. No `michat.exe` process remains.

**Screenshot:** `ac-06-packaged-app.png` (packaged post-onboarding screen captured offscreen via
CDP).

**Isolated method:** packaged smoke with `MICHAT_E2E_OFFSCREEN=1` and
`powershell -ExecutionPolicy Bypass -File scripts/smoke-packaged.ps1 -ScreenshotPath <run>/ac-06-packaged-app.png`;
CDP screenshot only.

---

## AC-07 — Regression suite is green and no runtime noise

**Given:** The final 2.2.4 tree.

**User action:** Run the full verification sequence and leave the app on the notebook/About final
state.

**Expected UI & deterministic reaction:** `pnpm test`, `pnpm lint`, `pnpm typecheck`,
`pnpm test:rag`, `pnpm check:security`, `pnpm check:cjk`, `pnpm check:migrations`,
`node scripts/check-asar.cjs`, `pnpm check:version`, the update E2E, and packaged smoke all exit 0. Renderer has no `console.error`/`pageerror`; captured app stderr has no `Unhandled`,
`Uncaught`, or `SQLITE_` lines (expected sanitized update warnings are allowlisted). No leftover
app process for the temp profile.

**Screenshot:** `ac-07-final-state.png`.

**Isolated method:** full suites plus offscreen Playwright; process list filtered by executable
and temp `--user-data-dir`.

---

## Human approval gate

The independent verifier writes `.opencode/evidence/<run-id>/report.md` with all AC IDs, a
non-empty `## Interactive Action Log` recording every click and observed reaction, the screenshot
list, artifact hashes, the secret-scan result, and the visibility-change approval.
`product_verify_pass` is called only after every AC passes. No tag, push, or release happens
without explicit user approval.
