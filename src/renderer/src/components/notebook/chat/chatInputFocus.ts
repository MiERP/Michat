export type ChatFocusIntent =
  | 'session-ready'
  | 'send-complete'
  | 'stream-complete'
  | 'window-focus'
  | 'panel-click'
  | 'dialog-close'

export interface ChatFocusContext {
  /**
   * Trigger label kept for call-site readability and diagnostics. All triggers
   * share the same guards (no intent-specific focus stealing).
   */
  intent: ChatFocusIntent
  disabled: boolean
  dialogOpen: boolean
  hasTextSelection: boolean
  alreadyFocused: boolean
  activeElementIsTextEntry: boolean
}

/**
 * Every trigger respects another text-entry control. Explicit triggers may move
 * focus away from a button (for example the Send button) but must never take the
 * caret from a notebook-title input, settings field, or an open dialog.
 */
export function shouldFocusChatInput(context: ChatFocusContext): boolean {
  if (context.disabled) return false
  if (context.dialogOpen) return false
  if (context.hasTextSelection) return false
  if (context.alreadyFocused) return false
  if (context.activeElementIsTextEntry) return false
  return true
}

export function isTextEntryElement(element: Element | null): boolean {
  if (!element) return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((element as HTMLElement).isContentEditable) return true
  const role = element.getAttribute('role')
  return role === 'textbox' || role === 'combobox'
}

export function hasActiveTextSelection(): boolean {
  const selection = window.getSelection()
  if (selection && selection.toString().length > 0) return true

  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    return active.selectionStart !== null && active.selectionStart !== active.selectionEnd
  }
  return false
}

export function hasOpenDialog(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
    )
  )
}

/**
 * Central focus entry point. Every trigger goes through the same guards so a
 * late animation frame can never steal focus from a dialog or another input.
 */
export function requestChatInputFocus(
  textarea: HTMLTextAreaElement | null,
  intent: ChatFocusIntent
): boolean {
  if (!textarea) return false

  const shouldFocus = shouldFocusChatInput({
    intent,
    disabled: textarea.disabled,
    dialogOpen: hasOpenDialog(),
    hasTextSelection: hasActiveTextSelection(),
    alreadyFocused: document.activeElement === textarea,
    activeElementIsTextEntry: isTextEntryElement(document.activeElement)
  })
  if (!shouldFocus) return false

  textarea.focus({ preventScroll: true })
  return document.activeElement === textarea
}
