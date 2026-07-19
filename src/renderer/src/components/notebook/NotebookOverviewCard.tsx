import { ReactElement, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { AlertCircle, RefreshCw, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import type { NotebookOverview } from '../../../../shared/types/notebookOverview'

interface NotebookOverviewCardProps {
  notebookId: string
}

function progressLabel(
  stage: string,
  translate: (key: string, options?: Record<string, string>) => string
): string {
  if (stage === 'synthesizing_overview') return translate('overviewSynthesizing')
  return translate('overviewPreparing')
}

export default function NotebookOverviewCard({
  notebookId
}: NotebookOverviewCardProps): ReactElement {
  const { t } = useTranslation('notebook')
  const [overview, setOverview] = useState<NotebookOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(null)
    void window.api.notebookOverview
      .get(notebookId)
      .then((result) => {
        if (active) setOverview(result)
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    const unsubscribe = window.api.notebookOverview.onProgress((event) => {
      if (event.notebookId !== notebookId) return
      setStage(event.stage)
      setProgress(event.progress)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [notebookId])

  const generate = async (): Promise<void> => {
    setIsGenerating(true)
    setProgress(0)
    setStage('')
    setError(null)
    try {
      const result = await window.api.notebookOverview.generate(notebookId)
      if (!result.success || !result.overview)
        throw new Error(result.error || t('overviewGenerateFailed'))
      setOverview(result.overview)
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : String(generateError))
    } finally {
      setIsGenerating(false)
    }
  }

  const cancel = async (): Promise<void> => {
    try {
      await window.api.notebookOverview.cancel(notebookId)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    }
  }

  const actionLabel = overview ? t('updateOverview') : t('createOverview')

  return (
    <section className="mb-5 rounded-lg border bg-muted/30 p-4" aria-label={t('notebookOverview')}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            {t('notebookOverview')}
          </h2>
          {overview?.status === 'stale' && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('overviewStale')}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isGenerating && (
            <Button size="sm" variant="outline" onClick={() => void cancel()}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t('overviewCancel')}
            </Button>
          )}
          <Button size="sm" onClick={() => void generate()} disabled={isGenerating || isLoading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? `${progressLabel(stage, t)} ${progress}%` : actionLabel}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {!isLoading && !overview && !error && (
        <p className="mt-3 text-sm text-muted-foreground">{t('overviewEmpty')}</p>
      )}

      {overview && (
        <div className="prose prose-sm mt-4 max-w-none dark:prose-invert">
          <ReactMarkdown>{overview.content}</ReactMarkdown>
        </div>
      )}
    </section>
  )
}
