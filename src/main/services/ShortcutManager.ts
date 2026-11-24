import { Menu, BrowserWindow } from 'electron'
import type Store from 'electron-store'
import { ShortcutConfig, ShortcutAction } from '../../shared/types'
import { defaultShortcuts } from '../config/defaults'
import type { StoreSchema } from '../config/types'

/**
 * Keyboard shortcut manager
 * Registers, unregisters, and manages application shortcuts
 */
export class ShortcutManager {
  private store: Store<StoreSchema>
  private mainWindow: BrowserWindow | null = null
  private shortcuts: ShortcutConfig[] = []
  private keyboardHandler: ((event: Electron.Event, input: Electron.Input) => void) | null = null

  constructor(store: Store<StoreSchema>) {
    this.store = store
  }

  /**
   * Set the main window reference
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * Register shortcuts using webContents listeners
   */
  registerShortcuts(): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []

    if (shortcuts.length === 0) {
      console.warn('[ShortcutManager] No shortcuts found in store, using defaults')
      this.store.set('shortcuts', defaultShortcuts)
      this.registerShortcuts()
      return
    }

    this.shortcuts = shortcuts.filter((s) => s.enabled)

    if (!this.mainWindow) {
      console.error('[ShortcutManager] Main window not set!')
      return
    }

    // Remove old listeners
    if (this.keyboardHandler) {
      this.mainWindow.webContents.removeListener('before-input-event', this.keyboardHandler)
    }

    // Create a new handler
    this.keyboardHandler = (event: Electron.Event, input: Electron.Input) => {
      this.handleKeyboardEvent(event, input)
    }

    // Wait until webContents is ready before registering
    if (this.mainWindow.webContents.isLoading()) {
      this.mainWindow.webContents.once('did-finish-load', () => {
        this.mainWindow!.webContents.on('before-input-event', this.keyboardHandler!)
      })
    } else {
      this.mainWindow.webContents.on('before-input-event', this.keyboardHandler)
    }
  }

  /**
   * Handle keyboard events
   */
  private handleKeyboardEvent(event: Electron.Event, input: Electron.Input): void {
    // Only handle keyDown events
    if (input.type !== 'keyDown') return

    // IME safety: never process shortcuts while composition is active
    if (input.isComposing || input.key === 'Process') return

    // Build the current key combination
    const modifiers: string[] = []
    if (input.control || input.meta) modifiers.push('CommandOrControl')
    if (input.shift) modifiers.push('Shift')
    if (input.alt) modifiers.push('Alt')

    // Get the key
    let key = input.key
    // Special key mapping and uppercase conversion
    if (key === 'Enter') {
      key = 'Enter'
    } else if (key.length === 1) {
      // Only uppercase letters; leave symbols unchanged
      if (key >= 'a' && key <= 'z') {
        key = key.toUpperCase()
      }
    }

    const accelerator = modifiers.length > 0 ? [...modifiers, key].join('+') : key

    // Find a matching shortcut
    const matchedShortcut = this.shortcuts.find((s) => s.accelerator === accelerator)

    if (matchedShortcut) {
      // Prevent the default behavior to avoid conflicts with system shortcuts
      event.preventDefault()
      this.handleShortcut(matchedShortcut.action)
    }
  }

  /**
   * Unregister all shortcuts
   */
  unregisterShortcuts(): void {
    // Clear the menu (removes all shortcuts)
    Menu.setApplicationMenu(null)
  }

  /**
   * Update a single shortcut
   */
  updateShortcut(action: ShortcutAction, newAccelerator: string): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []
    const index = shortcuts.findIndex((s) => s.action === action)

    if (index !== -1) {
      shortcuts[index].accelerator = newAccelerator
      this.store.set('shortcuts', shortcuts)
      this.registerShortcuts() // Re-register
    }
  }

  /**
   * Toggle a shortcut's enabled/disabled state
   */
  toggleShortcut(action: ShortcutAction, enabled: boolean): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []
    const index = shortcuts.findIndex((s) => s.action === action)

    if (index !== -1) {
      shortcuts[index].enabled = enabled
      this.store.set('shortcuts', shortcuts)
      this.registerShortcuts() // Re-register
    }
  }

  /**
   * Reset a single shortcut to its default value
   */
  resetSingle(action: ShortcutAction): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []
    const index = shortcuts.findIndex((s) => s.action === action)
    const defaultShortcut = defaultShortcuts.find((s) => s.action === action)

    if (index !== -1 && defaultShortcut) {
      shortcuts[index] = { ...defaultShortcut }
      this.store.set('shortcuts', shortcuts)
      this.registerShortcuts()
    }
  }

  /**
   * Reset to the default configuration
   */
  resetToDefaults(): void {
    this.store.set('shortcuts', defaultShortcuts)
    this.registerShortcuts()
  }

  /**
   * Handle shortcut trigger events
   * Send an IPC event to the renderer process
   */
  private handleShortcut(action: ShortcutAction): void {
    if (!this.mainWindow) {
      return
    }

    // Send an IPC event to the Renderer Process
    this.mainWindow.webContents.send('shortcut:triggered', action)
  }
}
