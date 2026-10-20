/**
 * KnowledgeLinksPanel
 * Panel "Tài liệu liên quan" + lifecycle cho document đang chọn trong SourcePanel.
 * Hiển thị liên kết tri thức (knowledgeLinks) và cho phép:
 *  - Tạo liên kết tự động (LLM trích keyword + FTS)
 *  - Đánh dấu lifecycle: draft / verified / outdated
 */

import { ReactElement, useEffect, useState } from 'react'
import { Link2, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../../ui/button'
import type { KnowledgeDocument } from '../../../../../shared/types/knowledge'

interface LinkInfo {
  id: string
  sourceDocumentId: string
  targetDocumentId: string
  targetTitle: string
  relationType: 'related' | 'extends' | 'contradicts'
  confidence: number
  evidence?: string | null
}

interface KnowledgeLinksPanelProps {
  notebookId: string
  document: KnowledgeDocument | null
  onDocumentChanged: () => void
}

const lifecycleLabels: Array<{
  state: 'draft' | 'verified' | 'outdated'
  label: string
  className: string
}> = [
  { state: 'draft', label: 'Nháp', className: 'text-muted-foreground border-border' },
  { state: 'verified', label: 'Đã xác minh', className: 'text-green-600 border-green-600/40' },
  { state: 'outdated', label: 'Lỗi thời', className: 'text-destructive border-destructive/40' }
]

export default function KnowledgeLinksPanel({
  notebookId,
  document,
  onDocumentChanged
}: KnowledgeLinksPanelProps): ReactElement | null {
  const [links, setLinks] = useState<LinkInfo[]>([])
  const [isLoadingLinks, setIsLoadingLinks] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!document) {
      setLinks([])
      setError('')
      return
    }

    const documentId = document.id
    const loadLinks = async () => {
      setIsLoadingLinks(true)
      setError('')
      try {
        const result = await window.api.knowledge.getLinks(notebookId, documentId)
        if (result?.success) {
          setLinks(result.links || [])
        } else {
          setError(result?.error || 'Không thể tải liên kết')
        }
      } catch (loadError) {
        setError((loadError as Error).message)
      } finally {
        setIsLoadingLinks(false)
      }
    }

    loadLinks()
  }, [notebookId, document])

  if (!document) {
    return (
      <section
        className="shrink-0 border-t border-border bg-muted/20 p-4"
        aria-label="Tài liệu liên quan"
      >
        <p className="text-center text-xs text-muted-foreground">
          Chọn tài liệu để xem liên kết tri thức
        </p>
      </section>
    )
  }

  const currentState =
    ((document.metadata as Record<string, unknown> | null)?.lifecycleState as
      | 'draft'
      | 'verified'
      | 'outdated'
      | undefined) || 'draft'

  const handleGenerateLinks = async () => {
    setIsGenerating(true)
    setError('')
    try {
      const result = await window.api.knowledge.generateLinks(document.id)
      if (result?.success) {
        const reloaded = await window.api.knowledge.getLinks(notebookId, document.id)
        if (reloaded?.success) setLinks(reloaded.links || [])
      } else {
        setError(result?.error || 'Không thể tạo liên kết')
      }
    } catch (generateError) {
      setError((generateError as Error).message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSetLifecycle = async (state: 'draft' | 'verified' | 'outdated') => {
    try {
      const result = await window.api.knowledge.setDocumentLifecycle(document.id, state)
      if (result?.success) {
        onDocumentChanged()
      } else {
        setError(result?.error || 'Không thể cập nhật trạng thái')
      }
    } catch (lifecycleError) {
      setError((lifecycleError as Error).message)
    }
  }

  return (
    <section
      className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border bg-muted/20"
      aria-label="Tài liệu liên quan"
    >
      <div className="sticky top-0 z-[1] flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
            Tài liệu liên quan
          </h2>
          <p className="truncate text-[11px] text-muted-foreground" title={document.title}>
            {document.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleGenerateLinks}
            disabled={isGenerating}
            title="Tạo liên kết tự động (LLM trích keyword + tìm kiếm)"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Tạo liên kết
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {/* Lifecycle */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">Trạng thái:</span>
          {lifecycleLabels.map((item) => (
            <Button
              key={item.state}
              variant="outline"
              size="sm"
              onClick={() => handleSetLifecycle(item.state)}
              className={`h-6 px-2 text-[11px] ${item.className} ${
                currentState === item.state ? 'ring-1 ring-primary/40 font-medium' : ''
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {/* Links */}
        {isLoadingLinks ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Chưa có liên kết. Bấm &quot;Tạo liên kết&quot; để hệ thống tự tìm tài liệu liên quan.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {links.map((link) => (
              <li key={link.id} className="rounded-md border border-border/70 bg-background/60 p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-medium" title={link.targetTitle}>
                    {link.targetTitle}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {Math.round(link.confidence * 100)}%
                  </span>
                </div>
                {link.evidence && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    Từ khóa: {link.evidence}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Gợi ý làm mới */}
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          Liên kết tự động được tạo khi thêm tài liệu mới và giảm dần theo thời gian nếu không dùng.
        </div>
      </div>
    </section>
  )
}
