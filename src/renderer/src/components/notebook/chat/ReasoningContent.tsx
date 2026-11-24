import { ReactElement, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { ScrollArea, ScrollBar } from '../../ui/scroll-area'
import { Button } from '../../ui/button'

interface ReasoningContentProps {
  content: string
  isStreaming: boolean
}

export default function ReasoningContent({
  content,
  isStreaming
}: ReasoningContentProps): ReactElement {
  const { t } = useTranslation('chat')
  const [isExpanded, setIsExpanded] = useState(false)

  // Watch thinking state changes and toggle expand/collapse automatically
  // Thinking starts → expand automatically
  // Thinking ends → collapse automatically
  /* eslint-disable */
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true)
    } else {
      setIsExpanded(false)
    }
  }, [isStreaming])
  /* eslint-enable */

  // Hide when there is no content and streaming is not active
  if (!content && !isStreaming) {
    return <></>
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/30 shadow-sm">
      {/* Header: expand/collapse button */}
      <Button
        onClick={() => setIsExpanded(!isExpanded)}
        variant="ghost"
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs h-auto hover:bg-muted/50"
      >
        <div className="flex items-center gap-1.5">
          {/* Thinking icon */}
          <svg
            className="w-3.5 h-3.5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>

          {/* Title */}
          <span className="font-medium text-foreground">
            {isStreaming ? t('thinkingInProgress') : t('thinkingProcess')}
          </span>

          {/* Streaming animation */}
          {isStreaming && (
            <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          )}
        </div>

        {/* Expand/collapse icon */}
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      {/* Content area: shown when expanded */}
      {isExpanded && (
        <div className="border-t border-border">
          <ScrollArea>
            <div className="px-3 py-2">
              {content ? (
                <div className="markdown-content text-xs text-muted-foreground">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeHighlight, rehypeKatex]}
                    components={{
                      a: ({ children, ...props }) => (
                        <a target="_blank" rel="noopener noreferrer" {...props}>
                          {children}
                        </a>
                      ),
                      // Table: wrap in scrollable container
                      table: ({ children, ...props }) => (
                        <ScrollArea className="w-full">
                          <table {...props}>{children}</table>
                          <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                      )
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                  {/* Streaming cursor */}
                  {isStreaming && (
                    <span className="inline-block w-2 h-3 ml-1 bg-muted-foreground/50 animate-pulse" />
                  )}
                </div>
              ) : (
                // Show placeholder when there is no content
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('thinkingShort')}</span>
                  <span className="inline-block w-2 h-3 bg-muted-foreground/50 animate-pulse" />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
