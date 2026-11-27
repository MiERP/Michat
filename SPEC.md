# SPEC — MiChat 2.2.4: reachable update feed and friendly update errors

## Problem

MiChat 2.2.3's update check fails with a raw GitHub 404:

```
404 "method: GET url: https://github.com/MiERP/Michat/releases.atom ..."
Headers: { ... set-cookie: _gh_sess=... }
```

Root cause: `electron-updater`'s `GitHubProvider` fetches `releases.atom` and
`/releases/latest` **anonymously**. The `MiERP/Michat` repository is currently **private**, so
anonymous requests to both endpoints return 404 even though authenticated `gh` can see the repo
and releases. The app then displays the raw `electron-updater` error, including response headers
and cookies, in the About panel.

The automatic startup check is defined but not wired: `checkForUpdatesOnStartup()` has no caller in
`src/main/index.ts`. When it is wired, `electron-updater` emits `'error'` and then rejects, so both
paths must honor the silent flag or a failed background check still writes `ERROR` into About.

## Solution

### 1. Make the update feed publicly reachable

- Run a pre-flight secret scan over the full Git history before changing visibility, record the
  maintainer approval, then change `MiERP/Michat` from private to public.
- This fixes existing 2.2.3 clients' **anonymous feed fetch (404) only**. Their raw error rendering
  and startup-state leak still require the 2.2.4 code changes below.
- Do **not** embed a token in the desktop app; a distributed token would be a credential leak.

### 2. Friendly, sanitized update errors everywhere

- Add a pure update-error module used by `UpdateService` and every update IPC handler.
- Classification order (case-insensitive, sanitized summary + error code; header noise cannot
  influence the result):
  1. `feed-unavailable`: `404`, `releases.atom`, `/releases/latest`,
     `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`, `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`,
     `ERR_UPDATER_INVALID_RELEASE_FEED`, `Not Found`.
  2. `network`: `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `ETIMEDOUT`, `ESOCKETTIMEDOUT`,
     `ECONNRESET`, `ENETUNREACH`, `socket hang up`, `getaddrinfo`, `timeout`.
  3. `unknown`: everything else, including non-`Error`, `null`, and empty messages.
- Sanitization pipeline: normalize CRLF and escaped `\n` → split lines → drop lines that start with
  `headers?:`, `set-cookie:`, `cookie:`, `content-security-policy:`, `content-type:`, `date:`,
  `server:`, `cache-control:`, `vary:`, `referrer-policy:`, `strict-transport-security:`, `x-…:` →
  drop stray `{…}` blocks → strip `_gh_sess=…`/cookie `key=value` pairs → collapse whitespace →
  first remaining non-empty line → truncate to 240 UTF-16 code units with `…`. If nothing remains,
  return `''` and let the UI use the generic localized message.
- `UpdateState.errorKind?: UpdateErrorKind` only; no free-text updater message crosses IPC or reaches
  the renderer. Sanitized detail stays in main-process logs. `UpdateCheckResult.error` and
  `UpdateOperationResult.error` carry the fixed code `update-failed`; all four update IPC handlers
  never forward raw updater text.
- About maps `errorKind` to `updateErrorFeedUnavailable`, `updateErrorNetwork`, or
  `updateErrorUnknown`. Exact locale values:

| Key                          | en-US                                                               | vi-VN                                                               |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `updateErrorFeedUnavailable` | Couldn't check for updates because the release feed is unavailable. | Không thể kiểm tra cập nhật vì nguồn phát hành không truy cập được. |
| `updateErrorNetwork`         | Couldn't reach the update server. Check your network and try again. | Không thể kết nối máy chủ cập nhật. Kiểm tra mạng rồi thử lại.      |
| `updateErrorUnknown`         | Update check failed. Please try again.                              | Kiểm tra cập nhật thất bại. Vui lòng thử lại.                       |

- Remove `alert(result.error)` entirely; errors are shown only in the localized update card. Raw
  `_gh_sess`, `Headers:`, `set-cookie`, or CSP text must never reach the UI, a native dialog, or a
  log line.

### 3. Wire and silence the automatic startup check

- Call `updateService.checkForUpdatesOnStartup()` in `src/main/index.ts` after
  `updateService.setMainWindow(mainWindow)`.
- `checkForUpdates({ silent })` threads one instance flag through both the `'error'` listener and
  the `catch` path. A silent failure logs a warning with the sanitized summary, emits no
  `update:state-changed`, and leaves state `IDLE`. A silent check also suppresses the `CHECKING`
  broadcast. Manual **Check for Updates** shows the categorized error.
- `autoUpdater.logger = null` (electron-updater's no-op logger) disables its raw stack/header
  logging; UpdateService logs only the sanitized classified summary.
- Manual checks always force `silent = false` and wait for an in-flight startup check to settle,
  then run a fresh check, so a click near the 5-second mark cannot inherit the silent flag.
- Download and install failures also use the sanitizer and set `ERROR` with `errorKind`; all four
  update IPC handlers return only the fixed `update-failed` code, never free-text updater output.
- Successful automatic checks may still publish `NOT_AVAILABLE`/`AVAILABLE`.
- Unit tests use a mocked `electron-updater` and assert both error paths leave `IDLE` with no state
  event, manual failure sets `ERROR` with the correct `errorKind`, download/install failures are
  sanitized, and a manual call overlapping a silent check runs a fresh non-silent check.

### 4. Deterministic update E2E with a local feed

- `autoUpdater.forceDevUpdateConfig = !app.isPackaged` (in the production branch). No test-only env
  string is added to the shipped app.
- The Playwright harness writes a temporary `dev-app-update.yml` before each launch and restores it
  afterward:
  - success: `provider: generic`, local HTTP server serves `latest.yml` for v2.2.3, so a 2.2.4 app
    deterministically reports `NOT_AVAILABLE`.
  - feed failure: server returns 404 for `latest.yml`, with `Set-Cookie: _gh_sess=fake-session`,
    `Content-Security-Policy: default-src 'none'`, and a body containing `releases.atom` /
    `Headers: { ... }`. Two exact raw updater errors are committed:
    `tests/fixtures/update/private-feed-error.txt` (404 first line) and
    `tests/fixtures/update/header-first-error.txt` (first line is a `Headers: { ... _gh_sess=... }`
    block). Unit tests assert the header-first line is dropped and the next safe line is kept.
  - download failure: server advertises v2.2.5 but returns HTTP 500 for the installer file
    (classified `unknown` → `updateErrorUnknown`).
  - network failure: URL points to a closed loopback port.
  - unknown failure: server returns HTTP 500 with a non-feed body.
- GitHub reachability is separate evidence. Anonymous curl checks record `PASS` or
  `NETWORK_UNAVAILABLE`; they block only when `MICHAT_REQUIRE_GITHUB=1`.

### 5. Release 2.2.4

- Version 2.2.4, CHANGELOG entry, README "What's new in 2.2.4", Windows installer, latest.yml, and
  GitHub release after the full gate and explicit approval.

## User stories

- **US-1** As a user on 2.2.3, my update check reaches the public feed and tells me whether a newer
  release exists instead of showing a raw 404.
- **US-2** As a user, a failed update check shows one clear localized sentence, never response
  headers or cookies.
- **US-3** As a user, a background startup check that fails stays silent; I only see an error when
  I explicitly press Check for Updates.
- **US-4** As a maintainer, I can prove the atom feed, latest.yml, and API release endpoint are
  anonymously reachable and that 2.2.4 is consistent everywhere.

## Implementation decisions

| Area                  | Decision                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository visibility | Public (GitHub setting); no code token, no public releases-only mirror.                                                                           |
| Error model           | `UpdateState` carries `errorKind` only; no free-text updater message crosses IPC.                                                                 |
| Classifier            | New pure module `src/main/utils/updateErrors.ts`; unit-tested.                                                                                    |
| Startup check         | Wired after `setMainWindow`; silent failure leaves `IDLE` and emits no state event.                                                               |
| UI                    | `AboutSettings` maps `errorKind` to i18n keys; no `alert` and no raw error rendering.                                                             |
| IPC safety            | All four handlers return fixed `update-failed`; state `errorKind` drives the UI. |
| Updater logging       | `autoUpdater.logger = null`; all update diagnostics go through the sanitized classifier.                                                          |
| E2E                   | Temporary `dev-app-update.yml` + local generic feed; `forceDevUpdateConfig = !app.isPackaged`; real clicks against success/404/network/500 feeds. |
| Version               | 2.2.4 patch; docs and installer after verification.                                                                                               |

## Testing seams

- `classifyUpdateError` / `sanitizeUpdateErrorMessage` pure unit matrix, including the exact
  private-feed fixture and non-Error/null inputs.
- `UpdateService` unit test with a mocked `electron-updater`: silent failure leaves `IDLE` from
  both the listener and catch paths and emits no state event; manual failure sets `ERROR` with
  `errorKind` and sanitized main-process log text.
- Playwright update E2E: local generic feed success → `NOT_AVAILABLE`; 404 feed, closed port, and
  HTTP 500 each → correct localized message; no `_gh_sess`/`Headers`/dialog text; silent startup
  failure → About stays `IDLE`; restart clears a previous manual error.
- Anonymous HTTP checks: atom feed, latest API, latest.yml return 200, or are recorded as
  `NETWORK_UNAVAILABLE` unless `MICHAT_REQUIRE_GITHUB=1`.
- Version/changelog/README/installer checks.
- Pre-flight secret scan over full Git history and a recorded approval before the public change.

## Out of scope

- Replacing `electron-updater` or changing the download/install flow.
- Embedding a GitHub token or adding a user-supplied update token.
- A separate public releases-only repository.
- Custom update server or CDN.
- Changing startup delay, download behavior, or release signing.
