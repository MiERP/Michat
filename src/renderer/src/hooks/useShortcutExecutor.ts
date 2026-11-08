import { useEffect } from 'react'
import { ShortcutAction } from '../../../shared/types'

/**
 * Shortcut Executor Hook
 * Listens for shortcut trigger events from the main process and dispatches CustomEvents.
 */
export function useShortcutExecutor(): void {
  useEffect(() => {
    const unsubscribe = window.api?.shortcuts?.onTriggered((action) => {
      switch (action) {
        case ShortcutAction.CREATE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:create-notebook'))
          break

        case ShortcutAction.CLOSE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:close-notebook'))
          break

        case ShortcutAction.TOGGLE_KNOWLEDGE_BASE:
          window.dispatchEvent(new CustomEvent('shortcut:toggle-knowledge-base'))
          break

        case ShortcutAction.TOGGLE_CREATIVE_SPACE:
          window.dispatchEvent(new CustomEvent('shortcut:toggle-creative-space'))
          break

        default:
          console.warn('[ShortcutExecutor] Unknown shortcut action:', action)
      }
    })

    return unsubscribe
  }, [])
}
