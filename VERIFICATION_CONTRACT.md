# VERIFICATION CONTRACT — MiChat 2.2.3

Every acceptance criterion is verified by an independent `desktop-verifier` run using
Playwright's Electron driver. The app launches with an isolated temporary `--user-data-dir` and
`MICHAT_E2E_OFFSCREEN=1`, which places the BrowserWindow at `x=-32000, y=-32000` and uses
`showInactive()` so it never appears on or steals focus from the interactive desktop.

**Input policy:** no OS-level input is allowed (no robotjs, pyautogui, SendKeys, or screen
capture). Playwright's synthetic CDP input (`locator.click()`, `.hover()`, `.press('Enter')`) is
required and is not OS input. Screenshots are `page.screenshot()` captures.

**Run directory:** `.opencode/evidence/<run-id>/`

**Global deterministic commands**

| Check                    | Command                                                      | Pass condition                            |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------- |
| Build renderer/main      | `pnpm build`                                                 | exit 0; no TypeScript errors              |
| Unit + integration tests | `pnpm test`                                                  | exit 0; all suites pass                   |
| Focus policy unit matrix | `pnpm exec vitest run tests/renderer/chatInputFocus.test.ts` | exit 0                                    |
| Lint                     | `pnpm lint`                                                  | exit 0; zero warnings                     |
| Typecheck                | `pnpm typecheck`                                             | exit 0                                    |
| Version consistency      | `pnpm check:version`                                         | exit 0; prints 2.2.3 consistency          |
| Theme/focus E2E          | `pnpm exec playwright test tests/e2e/theme-focus.spec.ts`    | exit 0                                    |
| Release installer        | `pnpm build:win`                                             | installer, blockmap, and latest.yml exist |

**Global offscreen assertion (all E2E criteria):** immediately after `firstWindow()`:

```ts
const bounds = await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].getBounds()
)
expect(bounds.x + bounds.width).toBeLessThanOrEqual(0)
expect(bounds.y).toBeLessThanOrEqual(0)
```

Windows clamps extremely negative coordinates, so the invariant is "no part of the window
intersects the virtual desktop", not an exact `-32000`.

---

## AC-01 — Fresh profile and missing-theme profile render light

**Visual check:** Launch a fresh temp profile and stop on onboarding. The background is light
(`#f0f3f0`), text is dark, the brand bar is the light/green gradient, and no dark surface is
visible. Capture `ac-01-fresh-light-onboarding.png` (1200×800). Then launch a second temp profile
whose `michat-config.json` contains `settingsVersion: 2` and `settings: {
"hasCompletedOnboarding": true }` (no `theme` key); capture the light home screen
`ac-01b-missing-theme-profile.png`.

**Deterministic check:**

- Fresh profile: `document.documentElement.classList.contains('dark') === false`.
- Fresh profile: `getComputedStyle(document.body).backgroundColor === 'rgb(240, 243, 240)'`.
- Fresh profile: `await window.api.settings.get('theme') === 'light'`.
- Fresh profile: BrowserWindow background color is `#fafafa`, read with
  `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())`.
- Both profiles: window bounds satisfy `x + width <= 0` and `y <= 0`.
- Missing-theme profile: remains light and `settings.get('theme') === 'light'`.
- Zero renderer `console.error` / `pageerror`; only known `console.log` lines are permitted.
- `app.close()` returns and no `electron`/`michat` process remains for either temp profile.

**Isolated method:** two Playwright `_electron.launch` runs with separate temp profiles and
`MICHAT_E2E_OFFSCREEN=1`; page screenshots only.

---

## AC-02 — A saved dark preference is preserved

**Visual check:** Set theme to dark through the settings bridge, reload, and capture the dark
notebook UI: `ac-02-existing-dark-preserved.png`.

**Deterministic check:**

- `await window.api.settings.set('theme', 'dark')` succeeds.
- Before any reload, `michat-config.json` in the temp `--user-data-dir` contains
  `settings.theme === 'dark'` (read with `fs.readFileSync`).
- After `page.reload()`, the root has class `dark` and body background is `rgb(17, 24, 32)`.
- After a full app relaunch with the same `--user-data-dir`, the root is still dark and
  `settings.get('theme') === 'dark'`.
- `michat-config.json` still contains `theme: 'dark'` after relaunch (not re-defaulted).
- Zero renderer console errors.

**Isolated method:** Playwright Electron with a reload and one relaunch against the same temp
profile; screenshot via `page.screenshot()`.

---

## AC-03 — Chat input is focused when a notebook opens

**Visual check:** Before configuring the API, create a notebook and capture the disabled composer
state for AC-11. Then save a real ephemeral fake API URL, wait for the composer to enable, and
capture the green focus ring and caret in the composer: `ac-03-chat-input-focused.png`.

**Deterministic check:**

- A notebook is created through `[data-testid="create-notebook"]`; route is
  `#/notebook/<id>`.
- An ephemeral fake HTTP server (same pattern as `tests/e2e/app.spec.ts`) is started on
  `127.0.0.1:0`; `window.api.api.saveConfig({ baseUrl })` is saved and
  `getConfig().baseUrl === baseUrl`.
- After the composer enables, `document.activeElement` is
  `[data-testid="chat-input"]`.
- The textarea `disabled` property is `false`.
- No dialog/alert dialog is open.
- Zero renderer console errors.

**Isolated method:** Playwright Electron; synthetic CDP clicks only; real loopback fake server;
no OS input.

---

## AC-04 — Focus returns after a deterministic reply

**Visual check:** Send `Tài liệu này nói về điều gì?` in the empty notebook. The refusal reply is
visible, the composer is enabled with focus ring and caret, and the input is empty. Capture
`ac-04-focus-after-reply.png`.

**Deterministic check:**

- Before sending, attach renderer counters to `window.api.onMessageCreated` and
  `window.api.onMessageChunk`.
- Send with `.press('Enter')`; the assistant reply contains `chưa có nội dung` (vi-VN) or
  `no indexed content` (en-US).
- Both event counters remain `0`, proving the deterministic non-streamed
  `result.content` path ran.
- `document.activeElement === [data-testid="chat-input"]`, textarea value is `''`, and the
  textarea is enabled.
- `window.api.getMessages(sessionId)` returns exactly one user row and one assistant row for the
  new exchange.
- After `page.reload()`, both rows are still returned and the reply text is visible.
- Zero renderer console errors.

**Isolated method:** Playwright Electron against real IPC + SQLite; no model call, no network
beyond the fake `/models` endpoint; replies are offline and repeatable.

---

## AC-05 — Focus is not stolen from inputs or open dialogs

**Visual check:** Capture three states:

- `ac-05-no-steal-title-edit.png` — notebook title input focused, composer not focused.
- `ac-05-no-steal-settings-dialog.png` — Settings dialog open, composer not focused.
- `ac-05-no-steal-alert-dialog.png` — delete-confirmation alert dialog open, composer not
  focused.

**Deterministic check:**

- Click the notebook title; the title `<input>` is `document.activeElement`.
- Dispatch `window.dispatchEvent(new Event('focus'))`; the title input remains active.
- While the title is still being edited, simulate a `message-created` → `text-delta` → `finish`
  stream through the main process. The `stream-complete` trigger must not move focus; the title
  input remains active.
- Press Escape to leave title edit mode (no text entry remains focused), then open Settings via
  the top-bar Settings button.
- Settings dialog is visible; `document.activeElement` is **not** the chat textarea.
- Dispatch `window` focus while the dialog is open; chat textarea still not active.
- Press Escape; after two deferred animation frames following Radix's `onCloseAutoFocus`, the chat
  textarea becomes focused (dialog-close policy).
- Hover the user message, click its delete action, and wait for `[role="alertdialog"]`.
- While the alert dialog is open, dispatch `window` focus; chat textarea remains inactive.
- Press Escape to cancel; `[role="alertdialog"]` disappears.
- Zero renderer console errors.

**Isolated method:** Playwright Electron DOM focus events and CDP clicks; no OS focus changes.

---

## AC-06 — Window focus, panel clicks, selection guard, and no redundant focus

**Visual check:** Capture `ac-06-refocus-window.png` (composer ring after window focus) and
`ac-06-refocus-panel-click.png` (composer ring after clicking empty chat-panel space).

**Deterministic check:**

- Spy on the textarea's `focus()` method; while already focused, dispatch `window` focus and
  assert the spy count stays `0` (no redundant call). A DOM `focus` event cannot prove this
  because a redundant `focus()` fires no event.
- Blur the composer; dispatch `window` focus; active element becomes
  `[data-testid="chat-input"]`.
- Blur again; click `[data-testid="chat-messages"]` at empty coordinates; composer becomes
  focused.
- Create a non-empty `Range` selection over the reply text, blur, then dispatch `window` focus;
  composer remains blurred.
- Clear the selection.
- Zero renderer console errors.

**Isolated method:** Playwright Electron; implementation listens on `window` for `focus`;
synthetic DOM events and CDP clicks only.

---

## AC-07 — Version, changelog, README, and About screen are consistent

**Visual check:** Open Settings → About; it displays `v2.2.3`. Capture `ac-07-about-version.png`.
Include the README "What's new in 2.2.3" section as text in `report.md`.

**Deterministic check:**

- `package.json` `version === '2.2.3'`.
- `CHANGELOG.md` contains `## [2.2.3] - 2026-11-27`.
- The 2.2.3 changelog entry mentions light default, chat input focus, message feedback,
  message deletion, and clipboard copy.
- `README.md` contains `### What's new in 2.2.3` and names the light default, chat input focus, and
  message actions.
- `pnpm check:version` exits 0 and prints `[version] 2.2.3 is consistent`.
- `electron-builder.yml` still uses `${version}` in `nsis.artifactName`.
- `git diff -U0 -- package.json` contains the added line
  `"version": "2.2.3"`; `git diff --name-only` is included in the report and reviewed for
  unexpected version-bearing files.
- `window.api.getAppVersion()` returns `2.2.3`.
- Zero renderer console errors.

**Isolated method:** shell assertions plus Playwright Electron About screenshot.

---

## AC-08 — Windows release artifacts exist and are 2.2.3

**Visual check:** The report lists `dist/` with exact names and sizes, and the packaged app's About
screen shows `v2.2.3`.

**Deterministic check:**

- `dist/michat-2.2.3-setup.exe` exists and is larger than 50 MB.
- `dist/michat-2.2.3-setup.exe.blockmap` exists.
- `dist/latest.yml` contains `version: 2.2.3` and `michat-2.2.3-setup.exe`.
- `pnpm smoke:packaged` exits 0 against `dist/win-unpacked` and reports `[version] packaged app
reports 2.2.3`.
- `pnpm build:win` exits 0.
- No unsigned-build/SmartScreen warning is treated as a failure.

**Isolated method:** file assertions plus the existing PowerShell packaged smoke; no OS input.

---

## AC-09 — Pending 2.2.3 message actions work and persist

**Visual check:** Hover the assistant reply; thumbs up/down controls are visible. Hover the user
message; copy and delete controls are visible. Capture `ac-09-message-actions.png`.

**Deterministic check:**

- Click the assistant copy button; inside `app.evaluate(({ clipboard }) => clipboard.readText())`
  the value equals the assistant reply content exactly (the main-process IPC path, not
  `navigator.clipboard`).
- Click the assistant thumbs-up button; `window.api.getMessages(sessionId)` reports
  `feedback === 'like'` for that assistant row; after reload it is still `'like'`.
- Record message ids before deletion; hover the user message, click delete, confirm the
  `[role="alertdialog"]`. After deletion `getMessages(sessionId)` contains neither the user id nor
  its paired assistant id.
- `pnpm test` passes `tests/renderer/messageActions.test.ts`, `tests/messagePairs.test.ts`,
  `tests/clipboardHandlers.test.ts`, `tests/messageFeedbackDb.test.ts`,
  `tests/chatHandlers.test.ts`, and `tests/rag/promptContext.test.ts`.
- Zero renderer console errors.

**Isolated method:** Playwright Electron against real IPC + SQLite; clipboard read through the
Electron main process; no OS clipboard UI.

---

## AC-10 — No runtime error noise and clean shutdown

**Visual check:** Capture `ac-10-final-state.png` after the E2E flow; the UI is intact (no error
boundary, no blank screen).

**Deterministic check:**

- No `pageerror` events during any E2E test.
- No renderer `console` messages of type `error`; known `console.log` theme lines are allowed.
- No main-process stderr lines containing `Unhandled`, `Uncaught`, `SQLITE_`, or `Error:`
  (captured from `app.process().stderr`).
- `app.close()` exits with code 0.
- No `electron` or `michat` process remains whose command line contains the temp
  `--user-data-dir`.
- The packaged smoke test leaves no `michat.exe` process for its temp profile.

**Isolated method:** Playwright process/stderr capture and a PowerShell process-command-line
check; packaged smoke from `pnpm smoke:packaged`.

---

## AC-11 — Disabled composer is never focused; focus policy unit matrix passes

**Visual check:** In a fresh notebook before API configuration, the composer is disabled and has
no focus ring; capture `ac-11-disabled-composer.png`.

**Deterministic check:**

- `[data-testid="chat-input"]` has `disabled === true` before API configuration.
- `document.activeElement` is not the chat textarea before API configuration.
- With no active session (home screen), no chat textarea exists and no focus error is logged.
- `pnpm exec vitest run tests/renderer/chatInputFocus.test.ts` exits 0 and covers:
  disabled, open dialog, open alert dialog, non-empty selection, already-focused,
  opportunistic trigger inside a text entry, explicit trigger from a button, and
  dialog-close with a non-text-entry active element.
- Zero renderer console errors.

**Isolated method:** Playwright Electron disabled-state screenshot plus the headless Vitest
matrix; no OS input.

---

## Human approval gate

The independent verifier writes `.opencode/evidence/<run-id>/report.md` with an AC matrix and the
full screenshot list. `product_verify_pass` is called only if every AC passes. The release is
**not** pushed, tagged, or published until the user gives the explicit final go-ahead.
