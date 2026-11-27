import { describe, expect, it } from 'vitest'
import {
  shouldFocusChatInput,
  type ChatFocusContext,
  type ChatFocusIntent
} from '../../src/renderer/src/components/notebook/chat/chatInputFocus'

function context(overrides: Partial<ChatFocusContext> = {}): ChatFocusContext {
  return {
    intent: 'session-ready',
    disabled: false,
    dialogOpen: false,
    hasTextSelection: false,
    alreadyFocused: false,
    activeElementIsTextEntry: false,
    ...overrides
  }
}

describe('shouldFocusChatInput', () => {
  it('focuses for every explicit trigger when nothing blocks it', () => {
    const explicit: ChatFocusIntent[] = ['session-ready', 'send-complete', 'stream-complete']
    for (const intent of explicit) {
      expect(shouldFocusChatInput(context({ intent }))).toBe(true)
    }
  })

  it('focuses for opportunistic triggers when focus is not in a text entry', () => {
    const opportunistic: ChatFocusIntent[] = ['window-focus', 'panel-click', 'dialog-close']
    for (const intent of opportunistic) {
      expect(shouldFocusChatInput(context({ intent }))).toBe(true)
    }
  })

  it('never focuses a disabled composer', () => {
    expect(shouldFocusChatInput(context({ disabled: true }))).toBe(false)
    expect(shouldFocusChatInput(context({ intent: 'window-focus', disabled: true }))).toBe(false)
  })

  it('never focuses while a dialog or alert dialog is open', () => {
    expect(shouldFocusChatInput(context({ dialogOpen: true }))).toBe(false)
    expect(shouldFocusChatInput(context({ intent: 'dialog-close', dialogOpen: true }))).toBe(false)
  })

  it('never replaces an active text selection', () => {
    expect(shouldFocusChatInput(context({ hasTextSelection: true }))).toBe(false)
    expect(shouldFocusChatInput(context({ intent: 'send-complete', hasTextSelection: true }))).toBe(
      false
    )
  })

  it('does not call focus again when the composer already has focus', () => {
    const intents: ChatFocusIntent[] = [
      'session-ready',
      'send-complete',
      'stream-complete',
      'window-focus',
      'panel-click',
      'dialog-close'
    ]
    for (const intent of intents) {
      expect(shouldFocusChatInput(context({ intent, alreadyFocused: true }))).toBe(false)
    }
  })

  it('never steals focus from another text entry, regardless of trigger', () => {
    const intents: ChatFocusIntent[] = [
      'session-ready',
      'send-complete',
      'stream-complete',
      'window-focus',
      'panel-click',
      'dialog-close'
    ]
    for (const intent of intents) {
      expect(shouldFocusChatInput(context({ intent, activeElementIsTextEntry: true }))).toBe(false)
    }
  })

  it('may move focus from a button after an explicit trigger', () => {
    expect(
      shouldFocusChatInput(context({ intent: 'send-complete', activeElementIsTextEntry: false }))
    ).toBe(true)
  })

  it('focuses after a dialog closes when focus landed on a button', () => {
    expect(
      shouldFocusChatInput(context({ intent: 'dialog-close', activeElementIsTextEntry: false }))
    ).toBe(true)
  })
})
