import { z } from 'zod'
import type Store from 'electron-store'
import { ShortcutAction } from '../../shared/types'
import type { ShortcutConfig } from '../../shared/types'
import { ShortcutManager } from '../services/ShortcutManager'
import type { StoreSchema } from '../config/types'
import { registerNoArgHandler, registerValidatedHandler } from './handlerRegistry'

const ShortcutSchemas = {
  update: z.object({
    action: z.nativeEnum(ShortcutAction),
    accelerator: z.string().min(1).max(100)
  }),
  toggle: z.object({
    action: z.nativeEnum(ShortcutAction),
    enabled: z.boolean()
  }),
  resetSingle: z.object({
    action: z.nativeEnum(ShortcutAction)
  })
}

/**
 * Registers the shortcut-related IPC handlers
 */
export function registerShortcutHandlers(
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>
): void {
  registerNoArgHandler('shortcuts:getAll', async () => {
    return (store.get('shortcuts') as ShortcutConfig[]) || []
  })

  registerValidatedHandler('shortcuts:update', ShortcutSchemas.update, async (args) => {
    shortcutManager.updateShortcut(args.action, args.accelerator)
  })

  registerValidatedHandler('shortcuts:toggle', ShortcutSchemas.toggle, async (args) => {
    shortcutManager.toggleShortcut(args.action, args.enabled)
  })

  registerValidatedHandler('shortcuts:resetSingle', ShortcutSchemas.resetSingle, async (args) => {
    shortcutManager.resetSingle(args.action)
  })

  registerNoArgHandler('shortcuts:reset', async () => {
    shortcutManager.resetToDefaults()
  })

  console.log('[IPC] Shortcut handlers registered')
}
