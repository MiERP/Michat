import { useEffect } from 'react'
import { ShortcutAction } from '../../../shared/types'

/**
 * Shortcut Executor Hook
 * Listens for shortcut trigger events from main process and dispatches CustomEvents.
 */
export function useShortcutExecutor() {
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return

    const handleShortcut = (_event: any, action: ShortcutAction) => {
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
    }

    ipc.on('shortcut:triggered', handleShortcut)

    return () => {
      ipc.removeAllListeners('shortcut:triggered')
    }
  }, [])
}
