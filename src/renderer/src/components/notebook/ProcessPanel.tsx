import { useState, useEffect, useRef, ReactElement } from 'react'
import {
  Send,
  StopCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chatStore'
import { useNotebookStore } from '../../store/notebookStore'
import MessageList from './chat/MessageList'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Card } from '../ui/card'
import { PanelHeader } from '../ui/panel-header'
import type { LicenseStatus } from '../../../../shared/types/license'

interface ProcessPanelProps {
  onToggleLeft?: () => void
  onToggleRight?: () => void
  isLeftCollapsed?: boolean
  isRightCollapsed?: boolean
}

export default function ProcessPanel({
  onToggleLeft,
  onToggleRight,
  isLeftCollapsed = false,
  isRightCollapsed = false
}: ProcessPanelProps = {}): ReactElement {
  const { t } = useTranslation('ui')
  const [input, setInput] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [hasProvider, setHasProvider] = useState(true)
  const [defaultChatModel, setDefaultChatModel] = useState<string | null>(null)
  const [licenseChecked, setLicenseChecked] = useState(false)
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>({
    valid: false,
    message: 'License not checked yet'
  })
  const { currentSession, messages, isNotebookStreaming, sendMessage, abortMessage } =
    useChatStore()
  const { currentNotebook, updateNotebook } = useNotebookStore()

  const [editingTitle, setEditingTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wasStreamingRef = useRef(false)
  const lastCompositionEndAtRef = useRef(0)

  const currentNotebookId = currentSession?.notebookId
  const isCurrentNotebookStreaming = currentNotebookId
    ? isNotebookStreaming(currentNotebookId)
    : false
  const canSend =
    currentSession &&
    !isCurrentNotebookStreaming &&
    input.trim() &&
    hasProvider &&
    defaultChatModel &&
    licenseChecked &&
    licenseStatus.valid
  const canStop = currentSession && isCurrentNotebookStreaming
  const licenseHint = licenseStatus.valid
    ? !licenseChecked
      ? 'Ãƒâ€žÃ‚Âang kiÃƒÂ¡Ã‚Â»Ã†â€™m tra bÃƒÂ¡Ã‚ÂºÃ‚Â£n quyÃƒÂ¡Ã‚Â»Ã‚Ân...'
      : ''
    : licenseStatus.expiresAt
      ? `BÃƒÂ¡Ã‚ÂºÃ‚Â£n quyÃƒÂ¡Ã‚Â»Ã‚Ân Ãƒâ€žÃ¢â‚¬ËœÃƒÆ’Ã‚Â£ hÃƒÂ¡Ã‚ÂºÃ‚Â¿t hÃƒÂ¡Ã‚ÂºÃ‚Â¡n vÃƒÆ’Ã‚Â o ngÃƒÆ’Ã‚Â y ${licenseStatus.expiresAt}.`
      : 'BÃƒÂ¡Ã‚ÂºÃ‚Â£n quyÃƒÂ¡Ã‚Â»Ã‚Ân khÃƒÆ’Ã‚Â´ng hÃƒÂ¡Ã‚Â»Ã‚Â£p lÃƒÂ¡Ã‚Â»Ã¢â‚¬Â¡ hoÃƒÂ¡Ã‚ÂºÃ‚Â·c chÃƒâ€ Ã‚Â°a Ãƒâ€žÃ¢â‚¬ËœÃƒâ€ Ã‚Â°ÃƒÂ¡Ã‚Â»Ã‚Â£c kÃƒÆ’Ã‚Â­ch hoÃƒÂ¡Ã‚ÂºÃ‚Â¡t.'

  // Check if there are available providers and get default model
  const checkProvider = async (): Promise<void> => {
    try {
      const providers = await window.api.getAllProviderConfigs()
      const hasEnabledProvider = providers.some((p) => p.enabled)
      setHasProvider(hasEnabledProvider)

      // Get default chat model
      const defaultModel = await window.api.settings.get('defaultChatModel')
      setDefaultChatModel(defaultModel || null)
    } catch (error) {
      console.error('Failed to check Provider configuration:', error)
      setHasProvider(false)
      setDefaultChatModel(null)
    }
  }

  const checkLicense = async (): Promise<void> => {
    try {
      if (!window.api.license?.getStatus) {
        setLicenseStatus({
          valid: false,
          reason: 'missing_file',
          message: 'License API unavailable'
        })
        return
      }

      const status = await Promise.race<LicenseStatus>([
        window.api.license.getStatus(),
        new Promise<LicenseStatus>((_, reject) =>
          setTimeout(() => reject(new Error('License check timeout')), 5000)
        )
      ])
      setLicenseStatus(status)
    } catch (error) {
      console.error('Failed to check license:', error)
      setLicenseStatus({
        valid: false,
        reason: 'invalid_format',
        message: 'Failed to read license'
      })
    } finally {
      setLicenseChecked(true)
    }
  }

  // Add useEffect listeners
  useEffect(() => {
    // 1. Check on page load
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkProvider()
    void checkLicense()

    // 2. Listen for Provider configuration change events
    const cleanup = window.api.onProviderConfigChanged(() => {
      void checkProvider()
    })

    // 3. Listen for settings change events
    const cleanupSettings = window.api.settings.onSettingsChange((newSettings) => {
      setDefaultChatModel(newSettings.defaultChatModel || null)
    })

    return () => {
      cleanup()
      cleanupSettings()
    }
  }, [])

  const handleSend = (): void => {
    if (!canSend) return

    sendMessage(currentSession.id, input.trim())
    setInput('')
  }



  const handleStop = async (): Promise<void> => {
    if (!canStop || !currentNotebookId) return
    await abortMessage(currentNotebookId)
  }

  // ÃƒÂ¤Ã‚Â½Ã‚Â¿ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ ref ÃƒÂ¥Ã‚Â­Ã‹Å“ÃƒÂ¥Ã¢â‚¬Å¡Ã‚Â¨ handleSend ÃƒÂ¥Ã¢â‚¬Â¡Ã‚Â½ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ÃƒÂ¥Ã‚Â¼Ã¢â‚¬Â¢ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ÃƒÂ¯Ã‚Â¼Ã…â€™ÃƒÂ©Ã‚ÂÃ‚Â¿ÃƒÂ¥Ã¢â‚¬Â¦Ã‚ÂÃƒÂ¤Ã‚ÂºÃ¢â‚¬Â¹ÃƒÂ¤Ã‚Â»Ã‚Â¶ÃƒÂ§Ã¢â‚¬ÂºÃ¢â‚¬ËœÃƒÂ¥Ã‚ÂÃ‚Â¬ÃƒÂ¥Ã¢â€žÂ¢Ã‚Â¨ÃƒÂ©Ã‚Â¢Ã¢â‚¬ËœÃƒÂ§Ã‚Â¹Ã‚ÂÃƒÂ©Ã¢â‚¬Â¡Ã‚ÂÃƒÂ¦Ã‚Â³Ã‚Â¨ÃƒÂ¥Ã¢â‚¬Â Ã…â€™
  const handleSendRef = useRef<() => void>(() => {})

  // ÃƒÂ¤Ã‚Â¿Ã‚ÂÃƒÂ¦Ã…â€™Ã‚Â ref ÃƒÂ¦Ã…â€™Ã¢â‚¬Â¡ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ¦Ã…â€œÃ¢â€šÂ¬ÃƒÂ¦Ã¢â‚¬â€œÃ‚Â°ÃƒÂ§Ã…Â¡Ã¢â‚¬Å¾ handleSend ÃƒÂ¥Ã¢â‚¬Â¡Ã‚Â½ÃƒÂ¦Ã¢â‚¬Â¢Ã‚Â°
  useEffect(() => {
    handleSendRef.current = handleSend
  })

  // ÃƒÂ§Ã¢â‚¬ÂºÃ¢â‚¬ËœÃƒÂ¥Ã‚ÂÃ‚Â¬ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ©Ã¢â€šÂ¬Ã‚ÂÃƒÂ¦Ã‚Â¶Ã‹â€ ÃƒÂ¦Ã‚ÂÃ‚Â¯ÃƒÂ¥Ã‚Â¿Ã‚Â«ÃƒÂ¦Ã‚ÂÃ‚Â·ÃƒÂ©Ã¢â‚¬ÂÃ‚Â®ÃƒÂ¯Ã‚Â¼Ã‹â€ ÃƒÂ¥Ã‚ÂÃ‚ÂªÃƒÂ¦Ã‚Â³Ã‚Â¨ÃƒÂ¥Ã¢â‚¬Â Ã…â€™ÃƒÂ¤Ã‚Â¸Ã¢â€šÂ¬ÃƒÂ¦Ã‚Â¬Ã‚Â¡ÃƒÂ¯Ã‚Â¼Ã¢â‚¬Â°
  useEffect(() => {
    const handleSendShortcut = () => {
      handleSendRef.current()
    }

    window.addEventListener('shortcut:send-message', handleSendShortcut)

    return () => {
      window.removeEventListener('shortcut:send-message', handleSendShortcut)
    }
  }, [])

  // Auto-resize textarea based on content
  const adjustTextareaHeight = (): void => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'

    // Calculate new height with min and max constraints
    const minHeight = 84 // ~3 rows
    const maxHeight = 280 // ~10 rows
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)

    textarea.style.height = `${newHeight}px`
  }

  // Handle input change with auto-resize
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInput(e.target.value)
    adjustTextareaHeight()
  }

  // Adjust height when input changes externally (e.g., after sending)
  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  useEffect(() => {
    if (wasStreamingRef.current && !isCurrentNotebookStreaming) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    wasStreamingRef.current = isCurrentNotebookStreaming
  }, [isCurrentNotebookStreaming])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // IME-safe: do not handle Enter while composition is active
    if (isComposing || (e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229) {
      return
    }

    // Some IME emit Enter right after compositionend; ignore this Enter
    if (Date.now() - lastCompositionEndAtRef.current < 250) {
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isCurrentNotebookStreaming) {
        void handleStop()
      } else {
        handleSend()
      }
    }
  }

  // Start editing title
  const handleStartEditTitle = (): void => {
    if (currentNotebook) {
      setEditingTitle(currentNotebook.title)
      setIsEditingTitle(true)
    }
  }

  // Save title
  const handleSaveTitle = async (): Promise<void> => {
    if (!currentNotebook || !editingTitle.trim()) {
      setIsEditingTitle(false)
      return
    }

    if (editingTitle.trim() !== currentNotebook.title) {
      try {
        await updateNotebook(currentNotebook.id, { title: editingTitle.trim() })
      } catch (error) {
        console.error('Failed to update Notebook title:', error)
      }
    }

    setIsEditingTitle(false)
  }

  // Cancel editing
  const handleCancelEditTitle = (): void => {
    setIsEditingTitle(false)
    setEditingTitle('')
  }

  // Title input box key handler
  const handleTitleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSaveTitle()
    } else if (e.key === 'Escape') {
      handleCancelEditTitle()
    }
  }

  return (
    <Card className="relative flex flex-col rounded-xl border-0 overflow-hidden h-full mx-0 shadow-md">
      <PanelHeader
        draggable
        left={
          onToggleLeft && (
            <Button
              onClick={onToggleLeft}
              variant="ghost"
              size="icon"
              className="w-8 h-8 shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={isLeftCollapsed ? 'ÃƒÂ¥Ã‚Â±Ã¢â‚¬Â¢ÃƒÂ¥Ã‚Â¼Ã¢â€šÂ¬ÃƒÂ§Ã…Â¸Ã‚Â¥ÃƒÂ¨Ã‚Â¯Ã¢â‚¬Â ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“' : 'ÃƒÂ¦Ã…Â Ã‹Å“ÃƒÂ¥Ã‚ÂÃ‚Â ÃƒÂ§Ã…Â¸Ã‚Â¥ÃƒÂ¨Ã‚Â¯Ã¢â‚¬Â ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Å“'}
            >
              {isLeftCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </Button>
          )
        }
        center={
          currentNotebook ? (
            isEditingTitle ? (
              <Input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={handleTitleKeyDown}
                autoFocus
                className="text-sm font-medium bg-transparent border-0 text-center min-w-0 max-w-full p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              />
            ) : (
              <Button
                onClick={handleStartEditTitle}
                variant="ghost"
                className="text-sm font-medium h-auto p-0"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title={t('clickToEditTitle')}
              >
                {currentNotebook.title}
              </Button>
            )
          ) : (
            <span className="text-sm text-muted-foreground">{t('selectOrCreateNotebook')}</span>
          )
        }
        right={
          onToggleRight && (
            <Button
              onClick={onToggleRight}
              variant="ghost"
              size="icon"
              className="w-8 h-8 shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={isRightCollapsed ? 'ÃƒÂ¥Ã‚Â±Ã¢â‚¬Â¢ÃƒÂ¥Ã‚Â¼Ã¢â€šÂ¬ÃƒÂ§Ã‚Â¬Ã¢â‚¬ÂÃƒÂ¨Ã‚Â®Ã‚Â°' : 'ÃƒÂ¦Ã…Â Ã‹Å“ÃƒÂ¥Ã‚ÂÃ‚Â ÃƒÂ§Ã‚Â¬Ã¢â‚¬ÂÃƒÂ¨Ã‚Â®Ã‚Â°'}
            >
              {isRightCollapsed ? (
                <PanelRightOpen className="w-4 h-4" />
              ) : (
                <PanelRightClose className="w-4 h-4" />
              )}
            </Button>
          )
        }
      />

      {/* ÃƒÂ¥Ã‚Â¯Ã‚Â¹ÃƒÂ¨Ã‚Â¯Ã‚ÂÃƒÂ¦Ã‚Â¶Ã‹â€ ÃƒÂ¦Ã‚ÂÃ‚Â¯ÃƒÂ¥Ã…â€™Ã‚ÂºÃƒÂ¥Ã…Â¸Ã…Â¸ - ÃƒÂ¤Ã‚Â½Ã‚Â¿ÃƒÂ§Ã¢â‚¬ÂÃ‚Â¨ absolute ÃƒÂ¥Ã‚Â®Ã…Â¡ÃƒÂ¤Ã‚Â½Ã‚ÂÃƒÂ¥Ã‚ÂÃ‚Â ÃƒÂ¦Ã‚Â»Ã‚Â¡ÃƒÂ¥Ã¢â‚¬Â°Ã‚Â©ÃƒÂ¤Ã‚Â½Ã¢â€žÂ¢ÃƒÂ§Ã‚Â©Ã‚ÂºÃƒÂ©Ã¢â‚¬â€Ã‚Â´ */}
      <div className="absolute top-14 bottom-0 left-0 right-0 overflow-hidden">
        <MessageList messages={messages} />
      </div>

      {/* ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Â¢ÃƒÂ©Ã†â€™Ã‚Â¨ÃƒÂ¦Ã‚Â¸Ã‚ÂÃƒÂ¥Ã‚ÂÃ‹Å“ÃƒÂ©Ã‚ÂÃ‚Â®ÃƒÂ§Ã‚Â½Ã‚Â© - ÃƒÂ§Ã¢â‚¬Â¹Ã‚Â¬ÃƒÂ§Ã‚Â«Ã¢â‚¬Â¹ÃƒÂ¤Ã‚ÂºÃ…Â½ÃƒÂ¦Ã‚Â¶Ã‹â€ ÃƒÂ¦Ã‚ÂÃ‚Â¯ÃƒÂ¥Ã…â€™Ã‚ÂºÃƒÂ¥Ã…Â¸Ã…Â¸ÃƒÂ¯Ã‚Â¼Ã…â€™ÃƒÂ©Ã‚ÂÃ‚Â¿ÃƒÂ¥Ã¢â‚¬Â¦Ã‚ÂÃƒÂ¥Ã‚Â Ã¢â‚¬Â ÃƒÂ¥Ã‚ÂÃ‚Â ÃƒÂ¤Ã‚Â¸Ã…Â ÃƒÂ¤Ã‚Â¸Ã¢â‚¬Â¹ÃƒÂ¦Ã¢â‚¬â€œÃ¢â‚¬Â¡ÃƒÂ©Ã¢â‚¬â€Ã‚Â®ÃƒÂ©Ã‚Â¢Ã‹Å“ */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none rounded-b-xl z-10"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, hsl(var(--card)) 40%, hsl(var(--card)) 100%)'
        }}
      />

      {/* ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Â¢ÃƒÂ©Ã†â€™Ã‚Â¨ÃƒÂ¨Ã‚Â¾Ã¢â‚¬Å“ÃƒÂ¥Ã¢â‚¬Â¦Ã‚Â¥ÃƒÂ¥Ã…â€™Ã‚ÂºÃƒÂ¥Ã…Â¸Ã…Â¸ - ÃƒÂ§Ã‚Â»Ã‚ÂÃƒÂ¥Ã‚Â¯Ã‚Â¹ÃƒÂ¥Ã‚Â®Ã…Â¡ÃƒÂ¤Ã‚Â½Ã‚ÂÃƒÂ¦Ã‚ÂµÃ‚Â®ÃƒÂ¥Ã…Â Ã‚Â¨ÃƒÂ¥Ã…â€œÃ‚Â¨ÃƒÂ¥Ã‚ÂºÃ¢â‚¬Â¢ÃƒÂ©Ã†â€™Ã‚Â¨ */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none shrink-0 z-20">
        <div className="relative bg-muted/95 backdrop-blur-md rounded-lg border border-border focus-within:ring-2 focus-within:ring-ring shadow-lg pointer-events-auto">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => {
              setIsComposing(false)
              lastCompositionEndAtRef.current = Date.now()
            }}
            placeholder={
              !currentSession
                ? t('selectSession')
                : !licenseChecked
                  ? 'Ãƒâ€žÃ‚Âang kiÃƒÂ¡Ã‚Â»Ã†â€™m tra bÃƒÂ¡Ã‚ÂºÃ‚Â£n quyÃƒÂ¡Ã‚Â»Ã‚Ân...'
                : !licenseStatus.valid
                  ? licenseHint
                : !hasProvider
                  ? t('noProviderConfigured')
                  : !defaultChatModel
                    ? t('noDefaultModel')
                    : t('inputMessage')
            }
            disabled={
              !currentSession ||
              isCurrentNotebookStreaming ||
              !hasProvider ||
              !defaultChatModel ||
              !licenseChecked ||
              !licenseStatus.valid
            }
            rows={1}
            className="w-full bg-transparent border-0 pl-4 pr-14 py-3 text-sm text-foreground placeholder-muted-foreground resize-none focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto min-h-[84px] max-h-[280px]"
          />

          {/* ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ©Ã¢â€šÂ¬Ã‚Â/ÃƒÂ¥Ã‚ÂÃ…â€œÃƒÂ¦Ã‚Â­Ã‚Â¢ÃƒÂ¦Ã…â€™Ã¢â‚¬Â°ÃƒÂ©Ã¢â‚¬â„¢Ã‚Â® - ÃƒÂ¥Ã…Â Ã‚Â¨ÃƒÂ¦Ã¢â€šÂ¬Ã‚ÂÃƒÂ¥Ã‹â€ Ã¢â‚¬Â¡ÃƒÂ¦Ã‚ÂÃ‚Â¢ */}
          {isCurrentNotebookStreaming ? (
            // ÃƒÂ¥Ã‚ÂÃ…â€œÃƒÂ¦Ã‚Â­Ã‚Â¢ÃƒÂ¦Ã…â€™Ã¢â‚¬Â°ÃƒÂ©Ã¢â‚¬â„¢Ã‚Â®
            <Button
              onClick={handleStop}
              disabled={!canStop}
              title="ÃƒÂ¥Ã‚ÂÃ…â€œÃƒÂ¦Ã‚Â­Ã‚Â¢ÃƒÂ§Ã¢â‚¬ÂÃ…Â¸ÃƒÂ¦Ã‹â€ Ã‚Â"
              variant="destructive"
              size="icon"
              className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
            >
              <StopCircle className="w-4 h-4" />
            </Button>
          ) : (
            // ÃƒÂ¥Ã‚ÂÃ¢â‚¬ËœÃƒÂ©Ã¢â€šÂ¬Ã‚ÂÃƒÂ¦Ã…â€™Ã¢â‚¬Â°ÃƒÂ©Ã¢â‚¬â„¢Ã‚Â®
            <Button
              onClick={handleSend}
              disabled={!canSend}
              title={
                !licenseChecked
                  ? 'Ãƒâ€žÃ‚Âang kiÃƒÂ¡Ã‚Â»Ã†â€™m tra bÃƒÂ¡Ã‚ÂºÃ‚Â£n quyÃƒÂ¡Ã‚Â»Ã‚Ân...'
                  : !licenseStatus.valid
                  ? licenseHint
                  : !hasProvider
                    ? t('noProviderConfigured')
                    : !currentSession
                      ? t('selectSession')
                      : ''
              }
              size="icon"
              className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

