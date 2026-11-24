import { ReactElement, useEffect, useState } from 'react'
import { RotateCcw, AlertCircle, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShortcutStore } from '../../store/shortcutStore'
import { ShortcutAction, ShortcutConfig } from '../../../../shared/types'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import SettingItem from './SettingItem'
import { isMac } from '../../lib/platform'

export default function ShortcutSettings(): ReactElement {
  const { t } = useTranslation(['settings', 'shortcuts'])
  const { shortcuts, loadShortcuts, updateShortcut, resetSingle, resetToDefaults, isConflict } =
    useShortcutStore()

  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)
  const [tempAccelerator, setTempAccelerator] = useState<string>('')
  const [conflictError, setConflictError] = useState<string>('')
  const [showResetDialog, setShowResetDialog] = useState(false)

  // Load shortcuts
  useEffect(() => {
    loadShortcuts()
  }, [loadShortcuts])

  // Listen for keyboard events while recording
  useEffect(() => {
    if (!recordingAction) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()

      const modifiers: string[] = []
      if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl')
      if (e.shiftKey) modifiers.push('Shift')
      if (e.altKey) modifiers.push('Alt')

      // Get the key
      let key = e.key
      // Special key mapping
      if (key === 'Escape') {
        key = 'Escape'
      } else if (key === 'Enter') {
        key = 'Enter'
      } else if (key === 'Space') {
        key = 'Space'
      } else if (key === 'Tab') {
        key = 'Tab'
      } else if (key.length === 1) {
        key = key.toUpperCase()
      }

      // Allow a bare Escape key
      if (key === 'Escape' && modifiers.length === 0) {
        setTempAccelerator('Escape')
        return
      }

      // Other keys require a modifier
      if (modifiers.length === 0) {
        setTempAccelerator('')
        return
      }

      const validKeys = ['Enter', 'Space', 'Tab']
      if (key.length === 1 || validKeys.includes(key)) {
        const accelerator = [...modifiers, key].join('+')
        setTempAccelerator(accelerator)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [recordingAction])

  const handleStartRecording = (action: ShortcutAction) => {
    setRecordingAction(action)
    setTempAccelerator('')
    setConflictError('')
  }

  const handleSaveShortcut = async () => {
    if (!recordingAction || !tempAccelerator) return

    // Check for conflicts
    if (isConflict(tempAccelerator, recordingAction)) {
      setConflictError(t('shortcuts:conflictError'))
      return
    }

    await updateShortcut(recordingAction, tempAccelerator)
    setRecordingAction(null)
    setTempAccelerator('')
    setConflictError('')
  }

  const handleCancelRecording = () => {
    setRecordingAction(null)
    setTempAccelerator('')
    setConflictError('')
  }

  const handleResetConfirm = async () => {
    await resetToDefaults()
    setShowResetDialog(false)
  }

  // Group by category
  const groupedShortcuts = shortcuts.reduce(
    (acc, shortcut) => {
      const category = getCategoryByAction(shortcut.action)
      if (!acc[category]) acc[category] = []
      acc[category].push(shortcut)
      return acc
    },
    {} as Record<string, ShortcutConfig[]>
  )

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      {/* Reset button */}
      <div className="flex justify-end">
        <Button
          onClick={() => setShowResetDialog(true)}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          {t('shortcuts:resetToDefaults')}
        </Button>
      </div>

      {/* Conflict error message */}
      {conflictError && (
        <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">{conflictError}</p>
            <p className="text-xs mt-1 opacity-80">{t('shortcuts:conflictHint')}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConflictError('')}
            className="h-auto p-1"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Shortcut list, grouped by category */}
      <div className="flex flex-col gap-4">
        {Object.entries(groupedShortcuts).map(([category, items]) => (
          <div key={category} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t(`shortcuts:category.${category}`)}
            </h3>
            <div className="flex flex-col gap-2">
              {items.map((shortcut) => (
                <ShortcutItem
                  key={shortcut.action}
                  shortcut={shortcut}
                  isRecording={recordingAction === shortcut.action}
                  tempAccelerator={tempAccelerator}
                  onStartRecording={() => handleStartRecording(shortcut.action)}
                  onSave={handleSaveShortcut}
                  onCancel={handleCancelRecording}
                  onReset={() => resetSingle(shortcut.action)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <RotateCcw className="w-5 h-5 text-destructive" />
              </div>
              {t('shortcuts:confirmResetTitle') || 'Reset shortcuts'}
            </DialogTitle>
            <DialogDescription>{t('shortcuts:confirmReset')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>
              {t('shortcuts:cancel') || 'Hủy'}
            </Button>
            <Button variant="destructive" onClick={handleResetConfirm}>
              {t('shortcuts:confirm') || 'Confirm reset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Helper: get the category for an action
function getCategoryByAction(action: ShortcutAction): string {
  const actionStr = action.toString()
  if (actionStr.includes('notebook')) {
    return 'notebook'
  }
  if (actionStr.includes('toggle')) {
    return 'panel'
  }
  if (actionStr.includes('message')) {
    return 'chat'
  }
  return 'other'
}

// Shortcut item component
interface ShortcutItemProps {
  shortcut: ShortcutConfig
  isRecording: boolean
  tempAccelerator: string
  onStartRecording: () => void
  onSave: () => void
  onCancel: () => void
  onReset: () => void
}

function ShortcutItem({
  shortcut,
  isRecording,
  tempAccelerator,
  onStartRecording,
  onSave,
  onCancel,
  onReset
}: ShortcutItemProps): ReactElement {
  const { t } = useTranslation('shortcuts')

  return (
    <SettingItem title={t(shortcut.description)} description="">
      <div className="flex items-center gap-3">
        {isRecording ? (
          // Recording mode
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
            <kbd className="px-4 py-2 bg-accent/50 text-accent-foreground rounded-lg border-2 border-primary/20 text-sm font-mono min-w-[140px] text-center transition-all shadow-lg shadow-primary/10 animate-pulse">
              {tempAccelerator || t('pressKey')}
            </kbd>
            <Button
              onClick={onSave}
              size="icon"
              variant="ghost"
              disabled={!tempAccelerator}
              className="h-9 w-9 hover:bg-primary/10 hover:text-primary transition-all"
            >
              <Check className="w-4 h-4" />
            </Button>
            <Button
              onClick={onCancel}
              size="icon"
              variant="ghost"
              className="h-9 w-9 hover:bg-destructive/10 hover:text-destructive transition-all"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          // Display mode
          <>
            <button
              onClick={onStartRecording}
              className="px-4 py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border text-sm font-mono min-w-[140px] text-center transition-all hover:scale-105 hover:shadow-md active:scale-95"
            >
              {formatAccelerator(shortcut.accelerator)}
            </button>
            <Button
              onClick={onReset}
              size="icon"
              variant="ghost"
              className="h-9 w-9 hover:bg-primary/10 hover:text-primary transition-all"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </SettingItem>
  )
}

// Format the shortcut for display (convert CommandOrControl to platform-specific symbols)
function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', isMac() ? '⌘' : 'Ctrl')
    .replace('Shift', isMac() ? '⇧' : 'Shift')
    .replace('Alt', isMac() ? '⌥' : 'Alt')
    .replace(/\+/g, ' ')
}
