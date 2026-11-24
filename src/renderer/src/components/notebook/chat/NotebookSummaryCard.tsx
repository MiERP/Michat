import { ReactElement, useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '../../ui/button'

interface NotebookSummaryState {
  summary: string
  generatedAt?: string
  model?: string
}

/**
 * Thẻ tóm tắt THỐNG NHẤT cấp notebook, nhúng vào đầu khung chat (cột giữa).
 *
 * Hiển thị ngay khi mở notebook — không cần click vào từng tài liệu. Với
 * notebook nhiều tài liệu, main process tổng hợp tóm tắt từng file thành một
 * đoạn 100-120 từ. Nút xoáy (RefreshCw) cho phép tạo lại thủ công; tóm tắt
 * cũng tự tạo nền khi upload, khi file đổi ngoài app, hoặc khi mở notebook
 * mà chưa có/đã cũ.
 */
export default function NotebookSummaryCard(): ReactElement | null {
  const { id: notebookId } = useParams<{ id: string }>()
  const [summary, setSummary] = useState<NotebookSummaryState | null>(null)
  const [pending, setPending] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (): Promise<void> => {
    if (!notebookId) return
    try {
      const result = await window.api.knowledge.getNotebookSummary(notebookId)
      if (!result.success) {
        setError(result.error || 'Không thể tải tóm tắt.')
        return
      }
      setSummary(result.summary ?? null)
      setPending(!!result.pending)
      setError('')
    } catch (loadError) {
      setError((loadError as Error).message)
    }
  }, [notebookId])

  useEffect(() => {
    void load()
  }, [load])

  // Job nền hoàn thành (enrich/summarize) hoặc file đổi → reload thẻ.
  useEffect(() => {
    if (!notebookId) return
    const cleanupChanged = window.api.knowledge.onDocumentsChanged(() => {
      void load()
    })
    const cleanupSynced = window.api.knowledge.onAutoSynced(() => {
      void load()
    })
    return () => {
      cleanupChanged()
      cleanupSynced()
    }
  }, [notebookId, load])

  if (!notebookId) return null

  const handleRegenerate = async (): Promise<void> => {
    setIsRegenerating(true)
    setError('')
    try {
      const result = await window.api.knowledge.regenerateNotebookSummary(notebookId)
      if (!result.success) {
        setError(result.error || 'Không thể tạo tóm tắt.')
        return
      }
      setSummary(result.summary?.summary ? { summary: result.summary.summary } : null)
      setPending(false)
    } catch (regenError) {
      setError((regenError as Error).message)
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-xs font-semibold">Tóm tắt notebook</span>
          {(pending || isRegenerating) && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {isRegenerating ? 'Đang tạo tóm tắt…' : 'Đang tạo tóm tắt nền…'}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => void handleRegenerate()}
          disabled={isRegenerating}
          title="Tổng hợp lại tóm tắt notebook (model chat local)"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {summary?.summary ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{summary.summary}</p>
      ) : pending ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Đang tổng hợp tóm tắt từ các tài liệu trong notebook — sẽ hiện ở đây khi xong.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Notebook chưa có tóm tắt — bấm nút xoáy để tạo ngay, hoặc chờ tác vụ nền tự chạy.
        </p>
      )}

      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
