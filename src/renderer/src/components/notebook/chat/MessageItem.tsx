import { ReactElement, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { BookPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../types/notebook'
import type { ChatCitation } from '../../../../../shared/types/chat'
import ReasoningContent from './ReasoningContent'
import { useItemStore } from '../../../store/itemStore'
import { useNotebookStore } from '../../../store/notebookStore'
import { useCitationStore } from '../../../store/citationStore'
import { Button } from '../../ui/button'
import { ScrollArea, ScrollBar } from '../../ui/scroll-area'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import './markdown.css'

interface MessageItemProps {
  message: ChatMessage
}

export default function MessageItem({ message }: MessageItemProps): ReactElement {
  const { t } = useTranslation(['common', 'chat'])
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isStreaming = message.isStreaming || false
  const [copied, setCopied] = useState(false)
  const [addedToNote, setAddedToNote] = useState(false)

  const { loadItems } = useItemStore()
  const { currentNotebook } = useNotebookStore()
  const setCitation = useCitationStore((state) => state.setCitation)
  const visibleCitations = useMemo<ChatCitation[]>(
    () => message.metadata?.citations || [],
    [message.metadata?.citations]
  )
  const renderedContent = useMemo(
    () =>
      linkifyCitationMarkers(
        ensureInlineCitationPlacement(message.content, visibleCitations),
        visibleCitations
      ),
    [message.content, visibleCitations]
  )

  // Copy message content
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  // Add to note
  const handleAddToNote = async () => {
    if (!currentNotebook) return

    try {
      const customTitle = buildChatNoteTitle(message.content)
      await window.api.createNote(currentNotebook.id, message.content, customTitle)
      await loadItems(currentNotebook.id)
      setAddedToNote(true)
      setTimeout(() => setAddedToNote(false), 2000)
    } catch (error) {
      console.error('Failed to add to note:', error)
    }
  }

  const handleCitationClick = async (index: number) => {
    const citation = visibleCitations.find((item) => item.index === index)
    if (!citation) return
    await setCitation(message.id, citation)
  }

  const handleMarkdownClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    const link = target?.closest('a') as HTMLAnchorElement | null
    if (!link) return

    const href = link.getAttribute('href') || ''
    const text = (link.textContent || '').replace(/\[|\]|\s/g, '')
    const isNumericText = /^\d+$/.test(text)
    const looksLikeCitationHref =
      href.startsWith('citation:') || href.startsWith('#citation') || href.includes('citation:')

    if (!looksLikeCitationHref && !isNumericText) return

    e.preventDefault()
    e.stopPropagation()

    const index = Number(href.replace('citation:', '').replace('#citation-', '') || text)
    if (Number.isFinite(index)) {
      void handleCitationClick(index)
    }
  }

  // System message: centered notification box
  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] min-w-0 bg-muted border border-border text-muted-foreground rounded-xl px-4 py-3 shadow-sm w-fit">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p(props) {
                  const { children, ...rest } = props
                  return (
                    <p className="text-sm whitespace-pre-wrap wrap-break-word m-0" {...rest}>
                      {children}
                    </p>
                  )
                },
                // Table: wrap in scrollable container
                table: ({ children, ...props }) => (
                  <ScrollArea className="w-full">
                    <table {...props}>{children}</table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )
              }}
            >
              {renderedContent}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  if (isUser) {
    // User message: blue background, right-aligned
    return (
      <div className="flex justify-end group">
        <div className="flex flex-col gap-1 max-w-[85%] min-w-0 items-end">
          <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-3 shadow-sm w-fit">
            <p className="text-sm whitespace-pre-wrap wrap-break-word message-content-selectable">
              {message.content}
            </p>
          </div>
          {/* Copy button */}
          <Button
            onClick={handleCopy}
            variant="ghost"
            className="self-end px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
            title={copied ? t('common:copied') : t('common:copy')}
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{t('common:copied')}</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>{t('common:copy')}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  // AI message: no background, left-aligned, Markdown rendered
  return (
    <div className="flex justify-start group">
      <div className="flex flex-col gap-3 max-w-[85%] min-w-0">
        {/* Reasoning process display - only shown when reasoning content exists */}
        {message.reasoningContent && (
          <ReasoningContent
            content={message.reasoningContent}
            isStreaming={message.isReasoningStreaming || false}
          />
        )}

        {message.content ? (
          <div
            className="markdown-content text-foreground px-2"
            onClickCapture={handleMarkdownClickCapture}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeHighlight, rehypeKatex]}
              components={{
                // Links: citation links render as inline footnote triggers
                a: ({ children, href, ...props }) => {
                  if (href?.startsWith('citation:')) {
                    const index = Number(href.replace('citation:', ''))
                    return (
                      <a
                        className="underline text-xs align-super mx-0.5 hover:text-foreground"
                        href={`citation:${index}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void handleCitationClick(index)
                        }}
                        title={`Open citation [${index}]`}
                      >
                        [{children}]
                      </a>
                    )
                  }

                  return (
                    <a target="_blank" rel="noopener noreferrer" href={href} {...props}>
                      {children}
                    </a>
                  )
                },
                // Table: wrap in scrollable container
                table: ({ children, ...props }) => (
                  <ScrollArea className="w-full">
                    <table {...props}>{children}</table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )
              }}
            >
              {renderedContent}
            </ReactMarkdown>
            {/* Streaming message cursor */}
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-muted-foreground animate-pulse" />
            )}
          </div>
        ) : (
          // Show cursor when message is empty and still streaming
          isStreaming && (
            <div className="flex items-center gap-2 px-2">
              <span className="text-sm text-muted-foreground">{t('chat:thinking')}</span>
              <span className="inline-block w-2 h-4 bg-muted-foreground animate-pulse" />
            </div>
          )
        )}
        {/* Action buttons - only shown when reply is complete and has content */}
        {message.content && !isStreaming && (
          <div className="flex items-center gap-2 self-start ml-2">
            {/* Copy button */}
            <Button
              onClick={handleCopy}
              variant="ghost"
              className="px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
              title={copied ? t('common:copied') : t('common:copy')}
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>{t('common:copied')}</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>{t('common:copy')}</span>
                </>
              )}
            </Button>

            {/* Add to note button */}
            <Button
              onClick={handleAddToNote}
              variant="ghost"
              className="px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
              title={addedToNote ? t('chat:addedToNote') : t('chat:addToNote')}
            >
              {addedToNote ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>{t('chat:added')}</span>
                </>
              ) : (
                <>
                  <BookPlus className="w-3 h-3" />
                  <span>{t('chat:addToNote')}</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function linkifyCitationMarkers(content: string, citations: ChatCitation[]): string {
  if (!content || citations.length === 0) return content

  const validIndexes = new Set(citations.map((citation) => citation.index))
  const segments = content.split(/(```[\s\S]*?```)/g)

  return segments
    .map((segment) => {
      if (segment.startsWith('```')) return segment
      return segment.replace(/\[(\d+)\](?!\s*\()/g, (match, rawIndex) => {
        const index = Number(rawIndex)
        if (!Number.isFinite(index) || !validIndexes.has(index)) return match
        return `[${index}](citation:${index})`
      })
    })
    .join('')
}

function ensureInlineCitationPlacement(content: string, citations: ChatCitation[]): string {
  if (!content || citations.length === 0) return content

  const cleaned = removeCitationBoilerplateLines(content)
  const validIndexes = new Set(citations.map((citation) => citation.index))
  const hasValidMarker = [...cleaned.matchAll(/\[(\d+)\](?!\s*\()/g)].some((match) =>
    validIndexes.has(Number(match[1]))
  )

  if (hasValidMarker) return cleaned

  // Do not inject synthetic citation indexes.
  // Forced fallback like [1] can point to an unrelated chunk and creates false provenance.
  return cleaned
}

function removeCitationBoilerplateLines(content: string): string {
  const patterns = [
    /^\s*thÃƒÂ´ng tin nÃƒÂ y Ã„â€˜Ã†Â°Ã¡Â»Â£c tÃƒÂ¬m thÃ¡ÂºÂ¥y\b/i,
    /^\s*thÃƒÂ´ng tin trÃƒÂªn Ã„â€˜Ã†Â°Ã¡Â»Â£c tÃƒÂ¬m thÃ¡ÂºÂ¥y\b/i,
    /^\s*nguÃ¡Â»â€œn thÃƒÂ´ng tin nÃƒÂ y\b/i,
    /^\s*this information was found\b/i,
    /^\s*the information was found\b/i,
    /^\s*source:\b/i
  ]

  const filtered = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      return !patterns.some((pattern) => pattern.test(trimmed))
    })
    .join('\n')

  return filtered.replace(/\n{3,}/g, '\n\n').trim()
}

function buildChatNoteTitle(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[(\d+)\]\(citation:\1\)/g, ' ')
    .replace(/\[(\d+)\]/g, ' ')
    .replace(/[-#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'Ghi chÃƒÂº tÃ¡Â»Â« chat'
  const max = 60
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max).trim()}...`
}
