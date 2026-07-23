import { ReactElement, useEffect, useId, useMemo, useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import type {
  LegalGraphDocumentStatus,
  LegalReasoningResult,
  LegalRelationType
} from '../../../../../shared/types/legalReasoning'
import { useKnowledgeStore } from '../../../store/knowledgeStore'

interface LegalReasoningPathCardProps {
  result: LegalReasoningResult
  onCitationClick?: (index: number) => void
}

const REASONING_TITLE = '\u0110\u01b0\u1eddng suy lu\u1eadn ph\u00e1p l\u00fd'
const STEP_LABEL = 'b\u01b0\u1edbc'
const PATH_LABEL = '\u0110\u01b0\u1eddng'
const MINIMUM_CONFIDENCE_LABEL = '\u0110\u1ed9 tin c\u1eady t\u1ed1i thi\u1ec3u'
const CITATION_GROUP_LABEL = 'Tr\u00edch d\u1eabn ch\u1ee9ng minh'
const OPEN_CITATION_LABEL = 'M\u1edf tr\u00edch d\u1eabn'
const NO_PATH_LABEL =
  'Ch\u01b0a c\u00f3 \u0111\u01b0\u1eddng suy lu\u1eadn \u0111\u00e3 x\u00e1c minh.'
const LIMITATIONS_LABEL = 'Gi\u1edbi h\u1ea1n:'
const SAFE_GRAPH_FAILURE_MESSAGE =
  'Kh\u00f4ng th\u1ec3 ho\u00e0n t\u1ea5t ph\u00e2n t\u00edch quan h\u1ec7. C\u00e2u tr\u1ea3 l\u1eddi t\u1eeb t\u00e0i li\u1ec7u tr\u1ef1c ti\u1ebfp v\u1eabn d\u00f9ng \u0111\u01b0\u1ee3c.'

const relationLabels: Record<LegalRelationType, string> = {
  references: 'tham chi\u1ebfu',
  defines: '\u0111\u1ecbnh ngh\u0129a',
  applies_to: '\u00e1p d\u1ee5ng cho',
  requires: 'y\u00eau c\u1ea7u',
  permits: 'cho ph\u00e9p',
  prohibits: 'c\u1ea5m',
  exception_to: 'ngo\u1ea1i l\u1ec7 c\u1ee7a',
  condition_for: '\u0111i\u1ec1u ki\u1ec7n cho',
  sanction_for: 'ch\u1ebf t\u00e0i cho',
  amends: 's\u1eeda \u0111\u1ed5i',
  replaces: 'thay th\u1ebf',
  repeals: 'b\u00e3i b\u1ecf'
}

const graphStatusLabels: Record<LegalReasoningResult['graphStatus'], string> = {
  ready: '\u0110\u00e3 s\u1eb5n s\u00e0ng',
  pending: '\u0110ang ch\u1edd ph\u00e2n t\u00edch \u0111\u1ed3 th\u1ecb',
  failed: 'Ph\u00e2n t\u00edch \u0111\u1ed3 th\u1ecb th\u1ea5t b\u1ea1i',
  unavailable: 'Ch\u01b0a c\u00f3 \u0111\u1ed3 th\u1ecb ph\u00e1p l\u00fd'
}

const graphStatusClasses: Record<LegalReasoningResult['graphStatus'], string> = {
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  unavailable: 'border-border bg-muted text-muted-foreground'
}

// eslint-disable-next-line react-refresh/only-export-components
export function getRelationLabel(relationType: LegalRelationType): string {
  return relationLabels[relationType]
}

// eslint-disable-next-line react-refresh/only-export-components
export function getGraphStatusLabel(status: LegalReasoningResult['graphStatus']): string {
  return graphStatusLabels[status]
}

export function LegalReasoningPathCard({
  result,
  onCitationClick
}: LegalReasoningPathCardProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false)
  const contentId = useId()
  const documentIds = useMemo(
    () => [...new Set((result.evidence ?? []).map((item) => item.documentId))],
    [result.evidence]
  )
  const statuses = useKnowledgeStore((state) => state.legalGraphStatuses)
  const loadLegalGraphStatus = useKnowledgeStore((state) => state.loadLegalGraphStatus)
  const retryLegalGraph = useKnowledgeStore((state) => state.retryLegalGraph)

  useEffect(() => {
    void Promise.all(documentIds.map((documentId) => loadLegalGraphStatus(documentId)))
  }, [documentIds, loadLegalGraphStatus])

  const liveEntries = documentIds
    .map((documentId) => ({ documentId, status: statuses[documentId] }))
    .filter(
      (entry): entry is { documentId: string; status: LegalGraphDocumentStatus } =>
        Boolean(entry.status)
    )
  const effectiveEntry =
    liveEntries.find((entry) => entry.status.status === 'failed') ??
    liveEntries.find((entry) => entry.status.status === 'processing') ??
    liveEntries.find((entry) => entry.status.status === 'retry') ??
    liveEntries.find((entry) => entry.status.status === 'pending') ??
    liveEntries.find((entry) => entry.status.status === 'ready') ??
    liveEntries.find((entry) => entry.status.status === 'unavailable')
  const liveStatus = effectiveEntry?.status.status
  const graphStatus: LegalReasoningResult['graphStatus'] =
    liveStatus === 'processing' || liveStatus === 'retry' || liveStatus === 'pending'
      ? 'pending'
      : liveStatus === 'ready' || liveStatus === 'failed' || liveStatus === 'unavailable'
        ? liveStatus
        : result.graphStatus
  const visiblePaths = graphStatus === 'ready' ? result.paths : []
  const stepCount = visiblePaths.reduce((total, path) => total + path.steps.length, 0)
  const minimumConfidence =
    visiblePaths.length > 0
      ? Math.min(...visiblePaths.map((path) => path.minimumConfidence))
      : undefined
  const sourceUnitCount = effectiveEntry?.status.sourceUnitCount ?? 0
  const processedUnitCount = effectiveEntry?.status.processedUnitCount ?? 0
  const progressPercent =
    sourceUnitCount > 0 ? Math.round((processedUnitCount / sourceUnitCount) * 100) : 0
  const showProgress =
    effectiveEntry != null &&
    (liveStatus === 'processing' || liveStatus === 'retry' || liveStatus === 'pending')

  return (
    <section className="mx-2 overflow-hidden rounded-lg border border-sky-500/25 bg-sky-500/5 text-xs text-foreground">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-300" />
          <span className="truncate font-medium">{REASONING_TITLE}</span>
          <span
            className={
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] ' +
              graphStatusClasses[graphStatus]
            }
          >
            {getGraphStatusLabel(graphStatus)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span>{stepCount + ' ' + STEP_LABEL}</span>
          {showProgress && sourceUnitCount > 0 && (
            <>
              <span>{processedUnitCount + '/' + sourceUnitCount}</span>
              <span>{progressPercent + '%'}</span>
            </>
          )}
          {minimumConfidence != null && <span>{Math.round(minimumConfidence * 100)}%</span>}
          <ChevronDown
            className={'h-3.5 w-3.5 transition-transform ' + (isExpanded ? 'rotate-180' : '')}
            aria-hidden="true"
          />
        </span>
      </button>

      {graphStatus === 'failed' && effectiveEntry && (
        <div
          className="flex items-start justify-between gap-3 border-t border-destructive/20 px-3 py-2 text-destructive"
          role="alert"
        >
          <span>{SAFE_GRAPH_FAILURE_MESSAGE}</span>
          <button
            type="button"
            data-legal-graph-retry
            className="shrink-0 rounded border border-destructive/30 px-2 py-1 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void retryLegalGraph(effectiveEntry.documentId)}
          >
            Thử lại
          </button>
        </div>
      )}

      {isExpanded && (
        <div id={contentId} className="space-y-3 border-t border-sky-500/20 px-3 py-2.5">
          {visiblePaths.length > 0 ? (
            visiblePaths.map((path, pathIndex) => (
              <section
                key={pathIndex + '-' + path.score}
                aria-label={PATH_LABEL + ' ' + (pathIndex + 1)}
              >
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{PATH_LABEL + ' ' + (pathIndex + 1)}</span>
                  <span>
                    {MINIMUM_CONFIDENCE_LABEL +
                      ' ' +
                      Math.round(path.minimumConfidence * 100) +
                      '%'}
                  </span>
                </div>
                <ol className="space-y-1.5">
                  {path.steps.map((step) => (
                    <li
                      key={step.relationId}
                      className="rounded-md border border-border/70 bg-background/70 px-2.5 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 leading-5">
                        <span className="font-medium">{step.sourceLabel}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {getRelationLabel(step.relationType)}
                        </span>
                        <span className="font-medium">{step.targetLabel}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {Math.round(step.confidence * 100)}%
                        </span>
                      </div>
                      {step.citationIds.length > 0 && (
                        <div
                          className="mt-1.5 flex flex-wrap gap-1"
                          aria-label={CITATION_GROUP_LABEL}
                        >
                          {step.citationIds.map((citationId) => (
                            <button
                              key={citationId}
                              type="button"
                              className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => onCitationClick?.(citationId)}
                              aria-label={OPEN_CITATION_LABEL + ' ' + citationId}
                            >
                              {'[' + citationId + ']'}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))
          ) : (
            <p className="text-muted-foreground">{NO_PATH_LABEL}</p>
          )}

          {!effectiveEntry && result.limitations.length > 0 && (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-amber-800 dark:text-amber-200">
              <span className="font-medium">{LIMITATIONS_LABEL + ' '}</span>
              {result.limitations.join(' ')}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
