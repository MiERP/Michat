import { useState, useEffect, useRef, ReactElement } from 'react'
import {
  Send,
  StopCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Filter,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chatStore'
import { useNotebookStore } from '../../store/notebookStore'
import MessageList from './chat/MessageList'
import NotebookSummaryCard from './chat/NotebookSummaryCard'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Card } from '../ui/card'
import { PanelHeader } from '../ui/panel-header'

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
  const {
    currentSession,
    messages,
    isNotebookStreaming,
    sendMessage,
    abortMessage,
    ragScope,
    setRagScope
  } = useChatStore()
  const { currentNotebook, updateNotebook } = useNotebookStore()

  const ragScopeLabel = ragScope
    ? [
        ragScope.sectionPath?.length ? `Mục: ${ragScope.sectionPath.join(' › ')}` : '',
        ragScope.pageRange
          ? ragScope.pageRange.from === ragScope.pageRange.to
            ? `Trang ${ragScope.pageRange.from}`
            : `Trang ${ragScope.pageRange.from}-${ragScope.pageRange.to}`
          : '',
        !ragScope.sectionPath?.length && !ragScope.pageRange && ragScope.documentIds?.length
          ? `Tài liệu đã chọn (${ragScope.documentIds.length})`
          : ''
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  const [editingTitle, setEditingTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastCompositionEndAtRef = useRef(0)

  const currentNotebookId = currentSession?.notebookId
  const isCurrentNotebookStreaming = currentNotebookId
    ? isNotebookStreaming(currentNotebookId)
    : false
  const canSend =
    currentSession && !isCurrentNotebookStreaming && input.trim() && hasProvider && defaultChatModel
  const canStop = currentSession && isCurrentNotebookStreaming

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

  // Add useEffect listeners
  useEffect(() => {
    // 1. Check on page load
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkProvider()

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

  // Use a ref to store the handleSend function reference and avoid re-registering listeners often
  const handleSendRef = useRef<() => void>(() => {})

  // Keep the ref pointing at the latest handleSend function
  useEffect(() => {
    handleSendRef.current = handleSend
  })

  // Listen for the send-message shortcut (registered only once)
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
              title={isLeftCollapsed ? 'Expand knowledge base' : 'Collapse knowledge base'}
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
              title={isRightCollapsed ? 'Expand notes' : 'Collapse notes'}
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

      {/* Chat message area - absolutely positioned to fill the remaining space; the
          notebook summary card is embedded at the top for reading before chatting */}
      <div className="absolute top-14 bottom-0 left-0 right-0 overflow-hidden flex flex-col">
        <NotebookSummaryCard />
        <div className="flex-1 min-h-0">
          <MessageList messages={messages} />
        </div>
      </div>

      {/* Bottom gradient mask - independent of the message area to avoid stacking context issues */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none rounded-b-xl z-10"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, hsl(var(--card)) 40%, hsl(var(--card)) 100%)'
        }}
      />

      {/* Bottom input area - absolutely positioned and floating at the bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none shrink-0 z-20">
        <div className="relative bg-muted/95 backdrop-blur-md rounded-lg border border-border focus-within:ring-2 focus-within:ring-ring shadow-lg pointer-events-auto">
          {/* Phạm vi tri thức đang áp dụng cho lượt hỏi kế tiếp */}
          {ragScopeLabel && (
            <div className="flex items-center gap-2 px-3 pt-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs">
                <Filter className="w-3 h-3" />
                {ragScopeLabel}
              </span>
              <Button
                onClick={() => setRagScope(null)}
                variant="ghost"
                size="icon"
                className="w-5 h-5 text-muted-foreground"
                title="Bỏ phạm vi — hỏi trên toàn bộ sổ tay"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}

          {/* Multi-line input */}
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
                : !hasProvider
                  ? t('noProviderConfigured')
                  : !defaultChatModel
                    ? t('noDefaultModel')
                    : t('inputMessage')
            }
            disabled={
              !currentSession || isCurrentNotebookStreaming || !hasProvider || !defaultChatModel
            }
            rows={1}
            className="w-full bg-transparent border-0 pl-4 pr-14 py-3 text-sm text-foreground placeholder-muted-foreground resize-none focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto min-h-[84px] max-h-[280px]"
          />

          {/* Send/stop button - switches dynamically */}
          {isCurrentNotebookStreaming ? (
            // Stop button
            <Button
              onClick={handleStop}
              disabled={!canStop}
              title="Stop generating"
              variant="destructive"
              size="icon"
              className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
            >
              <StopCircle className="w-4 h-4" />
            </Button>
          ) : (
            // Send button
            <Button
              onClick={handleSend}
              disabled={!canSend}
              title={
                !hasProvider ? t('noProviderConfigured') : !currentSession ? t('selectSession') : ''
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
