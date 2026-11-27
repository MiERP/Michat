# SPEC — MiChat 2.2.3: light default, chat-first focus, release

## Problem

MiChat 2.2.2 ships with a dark default theme (`defaultSettings.theme = 'dark'` and
`themeStore.theme = 'dark'`). New users get a dark UI even though the light theme is already the
complete default palette in `theme.css`. Users who want the light interface must change it in
Settings, and the work-in-progress that is already in the tree (message feedback, paired message
deletion, reliable clipboard copy, grounded refusals) is not released.

The notebook chat input also loses focus whenever a notebook or chat session loads, after a reply
finishes, or when the user returns to the window. The user must click the message box before
typing, which breaks the "open a notebook and ask" flow.

Finally, the project needs a consistent 2.2.3 release: version metadata, changelog, README, a
Windows installer, and GitHub release publication after verification.

## Solution

### 1. Light is the default theme

- Change the built-in default in `src/main/config/defaults.ts` from `dark` to `light`.
- Change the renderer store's initial value in `src/renderer/src/store/themeStore.ts` from `dark`
  to `light` so the first paint is light before the persisted setting resolves.
- Do **not** add a migration that rewrites an explicitly saved theme. Existing profiles that
  already stored `dark` keep dark. New profiles and profiles without a saved theme get light.
- The Electron window background already derives from the saved theme; keep that behavior.

### 2. Chat input always has priority

Add a small focus policy plus effects around the chat textarea in `ProcessPanel.tsx`.

Focus is requested:

1. When a notebook/session becomes available (initial load and session switch).
2. When the saved API configuration becomes ready and the input becomes enabled.
3. When a user-initiated `sendMessage` settles and the composer is enabled again. This covers
   both the streamed path (`message-chunk` finish) and the deterministic non-streamed path
   (`result.content`, for example the empty-knowledge-base refusal) that never enters streaming
   state.
4. When the application window regains focus (`window` event, not `document`).
5. When the user clicks non-interactive space in the chat panel (`click`, not `mousedown`).
6. After a modal dialog or alert dialog closes. The implementation waits two animation frames
   after Radix's `onCloseAutoFocus` restoration (or re-checks in `onCloseAutoFocus`), then
   re-checks the guard before focusing.

Focus is never taken when:

- The textarea is disabled (no session, no API configuration, or streaming in progress).
- A dialog or alert dialog is open (`[role="dialog"][data-state="open"]` **or**
  `[role="alertdialog"][data-state="open"]`).
- The user has a non-empty text selection: `window.getSelection().toString().length > 0`, or an
  `input`/`textarea` whose `selectionStart !== selectionEnd`.
- For every trigger, focus is currently in an input, textarea, select, contenteditable element,
  or `[role="textbox"]`/`[role="combobox"]`. Explicit triggers may move focus from a button but
  never from another text entry.
- The textarea is already focused (no redundant `focus()` calls).

The rules live in a pure helper (`shouldFocusChatInput`) so they are unit-testable without a DOM.
The textarea receives stable test hooks (`data-testid="chat-input"`) and the message area gets
`data-testid="chat-messages"` for deterministic E2E and visual verification. Test hooks have no
production behavior.

### 3. Ship pending 2.2.3 work

The release includes the already-written working-tree changes:

- Assistant message feedback (thumbs up/down) persisted through the new migration.
- Deleting a user message deletes its paired assistant reply and aborts an active stream.
- Copy uses the Electron main-process clipboard with a browser fallback, so packaged builds work.
- Empty / ungrounded knowledge-base answers are refused deterministically instead of being
  answered from model memory.
- Chit-chat, grounding and message-pair helpers are extracted and unit-tested.

### 4. Version and release

- `package.json` version: `2.2.3`.
- `CHANGELOG.md` entry `## [2.2.3] - 2026-11-27` describing the user-visible changes.
- `README.md` gains a "What's new in 2.2.3" section.
- `pnpm check:version`, lint, typecheck, tests, build, and Windows packaging pass.
- Build `dist/michat-2.2.3-setup.exe` plus `latest.yml`; publish to GitHub only after the final
  human approval gate.

## User stories

- **US-1** As a new user, I open MiChat and see the light interface immediately, without visiting
  Settings.
- **US-2** As an existing user who selected dark, my choice is preserved after upgrading.
- **US-3** As a user opening a notebook, the caret is already in the chat box, so I can type
  immediately.
- **US-4** As a user sending a message, after the answer finishes the caret returns to the chat
  box for the next question.
- **US-5** As a user editing a title or settings field, the chat box never steals my caret.
- **US-6** As a user who alt-tabs back to MiChat, the chat box is ready for input when nothing
  else is being edited.
- **US-7** As a maintainer, I can verify the 2.2.3 version, changelog, README, and installer from
  one deterministic checklist.

## Implementation decisions

| Area                | Decision                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme default       | `defaultSettings.theme = 'light'`; `themeStore` initial state `light`; no forced migration.                                                                                           |
| Focus policy        | New pure module `chatInputFocus.ts`; orchestration in `ProcessPanel.tsx`; ref-based focus.                                                                                            |
| Focus triggers      | Session/API ready, `sendMessage` settle (non-streamed reply), stream end, window `focus`, chat-area click, dialog-close observer with `requestAnimationFrame` re-check.               |
| Focus guard         | Disabled, open dialog/alert dialog, text selection, other text-entry element, already focused.                                                                                        |
| Test hooks          | `data-testid="chat-input"`, `data-testid="chat-messages"`, `data-testid="create-notebook"`; no behavior in test hooks.                                                                |
| Isolated E2E window | `MICHAT_E2E_OFFSCREEN=1` makes `createMainWindow()` place the window at `x=-32000, y=-32000` and use `showInactive()` so Playwright can render and screenshot without focus stealing. |
| Tests               | Unit matrix for `shouldFocusChatInput`; Playwright Electron E2E for theme + focus + persistence + version; existing suites for shipped pending work.                                  |
| Version             | Manual edit of `package.json` + `CHANGELOG.md` to keep the existing formatting; validate with `pnpm check:version`.                                                                   |
| Release             | `pnpm build:win`; artifact `dist/michat-2.2.3-setup.exe`; `latest.yml`; GitHub release after approval.                                                                                |

## Testing seams

- `shouldFocusChatInput` pure function — disabled, dialog, alert dialog, selection, text-entry,
  already focused, opportunistic vs explicit trigger combinations.
- Theme defaults — assert `defaultSettings.theme` and `themeStore` initial state; E2E fresh
  profile, profile with `settingsVersion >= 2` and no `theme`, and profile with a persisted dark
  value read back from `michat-config.json`.
- ProcessPanel E2E — session load focus, non-streamed reply focus, window-focus refocus, panel
  click, no steal from title input/settings/alert dialogs, no focus while disabled or already
  focused.
- Release metadata — `scripts/version.cjs check`, changelog date/content, README statements,
  installer + `latest.yml` + blockmap existence.
- Pending work — existing unit/integration tests (`chatStore`, `messageActions`, `messagePairs`,
  `clipboardHandlers`, `chatHandlers`, `promptContext`) remain green.

## Out of scope

- Removing or redesigning the dark theme.
- Re-theming the custom titlebar / Windows overlay colors.
- Changing chat streaming behavior, model selection, or RAG retrieval quality.
- Auto-update delivery beyond publishing `latest.yml`.
- macOS/Linux installers for this release (Windows installer only).
- Corrupt-JSON store recovery (electron-store's `clearInvalidConfig` behavior is unchanged).
- Composer layout changes on window resize.
- Force-pushing, rewriting history, or publishing without the final approval gate.
