import { clipboard, ipcMain } from 'electron'
import { ClipboardSchemas, validate } from './validation'

/**
 * Registers clipboard IPC handlers.
 *
 * The renderer's `navigator.clipboard` is unavailable or permission-gated in
 * some Electron environments; writing through the main-process clipboard is
 * reliable for both user and assistant messages.
 */
export function registerClipboardHandlers(): void {
  ipcMain.handle(
    'clipboard:write-text',
    validate(ClipboardSchemas.writeText, async (args) => {
      clipboard.writeText(args.text)
      return { success: true }
    })
  )

  console.log('[IPC] Clipboard handlers registered')
}
