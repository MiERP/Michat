// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasActiveTextSelection,
  hasOpenDialog,
  isTextEntryElement,
  requestChatInputFocus
} from '../../src/renderer/src/components/notebook/chat/chatInputFocus'

function appendTextarea(value = ''): HTMLTextAreaElement {
  const element = document.createElement('textarea')
  element.value = value
  document.body.appendChild(element)
  return element
}

function appendDialog(role: 'dialog' | 'alertdialog', state: 'open' | 'closed'): HTMLDivElement {
  const element = document.createElement('div')
  element.setAttribute('role', role)
  element.setAttribute('data-state', state)
  document.body.appendChild(element)
  return element
}

afterEach(() => {
  vi.restoreAllMocks()
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('isTextEntryElement', () => {
  it('recognizes native, contenteditable, and ARIA text-entry controls', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(isTextEntryElement(document.createElement(tag)), tag).toBe(true)
    }

    // jsdom does not implement isContentEditable; stub the property Chromium exposes.
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isTextEntryElement(editable)).toBe(true)

    for (const role of ['textbox', 'combobox']) {
      const element = document.createElement('div')
      element.setAttribute('role', role)
      expect(isTextEntryElement(element), role).toBe(true)
    }
  })

  it('ignores buttons, plain containers, and a missing element', () => {
    expect(isTextEntryElement(null)).toBe(false)
    expect(isTextEntryElement(document.createElement('div'))).toBe(false)
    expect(isTextEntryElement(document.createElement('button'))).toBe(false)
  })
})

describe('hasActiveTextSelection', () => {
  it('detects a document range selection', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'select me'
    document.body.appendChild(paragraph)

    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    expect(hasActiveTextSelection()).toBe(true)
  })

  it('detects a partial selection inside the focused input or textarea', () => {
    const area = appendTextarea('hello')
    area.focus()
    area.setSelectionRange(0, 3)

    expect(hasActiveTextSelection()).toBe(true)
  })

  it('ignores a caret with no selected characters', () => {
    const area = appendTextarea('hello')
    area.focus()
    area.setSelectionRange(2, 2)

    expect(hasActiveTextSelection()).toBe(false)
  })

  it('is false when nothing is selected', () => {
    expect(hasActiveTextSelection()).toBe(false)
  })
})

describe('hasOpenDialog', () => {
  it('detects open dialogs and alert dialogs, and ignores closed ones', () => {
    const dialog = appendDialog('dialog', 'open')
    expect(hasOpenDialog()).toBe(true)

    dialog.setAttribute('data-state', 'closed')
    expect(hasOpenDialog()).toBe(false)

    appendDialog('alertdialog', 'open')
    expect(hasOpenDialog()).toBe(true)
  })
})

describe('requestChatInputFocus', () => {
  it('focuses an enabled composer when the policy allows it', () => {
    const area = appendTextarea()

    expect(requestChatInputFocus(area, 'session-ready')).toBe(true)
    expect(document.activeElement).toBe(area)
  })

  it('does nothing without a textarea or while the composer is disabled', () => {
    expect(requestChatInputFocus(null, 'session-ready')).toBe(false)

    const disabled = appendTextarea()
    disabled.disabled = true
    expect(requestChatInputFocus(disabled, 'session-ready')).toBe(false)
    expect(document.activeElement).not.toBe(disabled)
  })

  it('does not call focus again when the composer already has focus', () => {
    const area = appendTextarea()
    area.focus()
    const focusSpy = vi.spyOn(area, 'focus')

    expect(requestChatInputFocus(area, 'window-focus')).toBe(false)
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('does not steal focus from another text entry for opportunistic triggers', () => {
    const composer = appendTextarea()
    const title = document.createElement('input')
    document.body.appendChild(title)
    title.focus()

    expect(requestChatInputFocus(composer, 'window-focus')).toBe(false)
    expect(document.activeElement).toBe(title)
  })

  it('respects an open dialog and an active text selection', () => {
    const composer = appendTextarea()
    const dialog = appendDialog('dialog', 'open')

    expect(requestChatInputFocus(composer, 'window-focus')).toBe(false)
    dialog.remove()

    const other = appendTextarea('selected text')
    other.focus()
    other.setSelectionRange(0, 4)
    expect(requestChatInputFocus(composer, 'session-ready')).toBe(false)
    expect(document.activeElement).toBe(other)
  })
})
