import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, RefreshCw, Plus, ChevronDown, ChevronUp, Files, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuizStore, setupQuizListeners } from '../../store/quizStore'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { Button } from '../ui/button'
import DocumentPicker from '../notebook/source/DocumentPicker'
import QuizGenerating from '../notebook/quiz/QuizGenerating'
import QuizQuestionView from '../notebook/quiz/QuizQuestionView'
import QuizResultView from '../notebook/quiz/QuizResultView'
import QuizStartDialog, { type QuizStartParams } from '../notebook/quiz/QuizStartDialog'

export default function QuizPage() {
  const { notebookId, quizId } = useParams<{ notebookId?: string; quizId?: string }>()
  const { t } = useTranslation('quiz')
  const {
    currentQuiz,
    isGenerating,
    generationProgress,
    isResultMode,
    loadLatestQuiz,
    loadQuiz,
    generateQuiz,
    resetQuiz
  } = useQuizStore()
  const { documents, loadDocuments } = useKnowledgeStore()

  const [isLoading, setIsLoading] = useState(true)
  const [platform, setPlatform] = useState<string>('')
  const [error, setError] = useState('')

  // Tạo mới: chọn tài liệu (rỗng = tất cả)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [isStartDialogOpen, setIsStartDialogOpen] = useState(false)

  // Get platform info
  useEffect(() => {
    const getPlatform = async () => {
      try {
        const platformName = await window.api.getPlatform()
        setPlatform(platformName)
      } catch (err) {
        console.error('Failed to get platform:', err)
      }
    }
    getPlatform()
  }, [])

  // Load quiz data
  useEffect(() => {
    const loadData = async (): Promise<void> => {
      setIsLoading(true)
      try {
        if (quizId) {
          await loadQuiz(quizId)
        } else if (notebookId) {
          await loadLatestQuiz(notebookId)
          void loadDocuments(notebookId)
        }
      } catch (err) {
        console.error('[QuizPage] Failed to load quiz:', err)
      } finally {
        setIsLoading(false)
      }
    }

    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, quizId])

  // Đăng ký progress listener suốt vòng đời trang (trước đây bị cleanup ngay
  // sau khi load nên thanh tiến độ đứng im khi đang tạo câu hỏi).
  useEffect(() => {
    const cleanup = setupQuizListeners()
    return cleanup
  }, [])

  const handleStartGeneration = async (params: QuizStartParams) => {
    if (!notebookId) return
    setError('')
    setShowPicker(false)
    try {
      await generateQuiz(notebookId, {
        questionCount: params.questionCount,
        difficulty: params.difficulty,
        customPrompt: params.customPrompt,
        documentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined
      })
    } catch (err) {
      const message =
        (err as Error)?.message || 'Không thể tạo câu hỏi. Hãy kiểm tra model chat trong Cài đặt.'
      setError(message)
      console.error('[QuizPage] Failed to generate quiz:', err)
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      resetQuiz()
    }
  }, [resetQuiz])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Title bar - vùng kéo cửa sổ */}
      <div
        className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-border bg-background"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {platform === 'darwin' ? <div className="w-16" /> : <div className="w-8" />}
        <span className="text-sm font-medium text-foreground">{t('quiz')}</span>
        {/* Windows: chừa chỗ cho nút điều khiển cửa sổ (titleBarOverlay) */}
        {platform === 'win32' ? <div className="w-[138px]" /> : <div className="w-8" />}
      </div>

      {/* Toolbar */}
      {notebookId && (
        <div className="shrink-0 flex items-center gap-2 border-b border-border bg-card px-3 py-2">
          <Button
            size="sm"
            onClick={() => setShowPicker(!showPicker)}
            variant="outline"
            className="h-8"
            disabled={isGenerating}
          >
            <Files className="h-4 w-4" />
            {selectedDocIds.length > 0 ? `Tài liệu (${selectedDocIds.length})` : 'Tất cả tài liệu'}
            {showPicker ? (
              <ChevronUp className="ml-1 h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            )}
          </Button>

          {currentQuiz ? (
            <Button
              size="sm"
              onClick={() => setIsStartDialogOpen(true)}
              disabled={isGenerating}
              className="h-8"
            >
              <RefreshCw className="h-4 w-4" />
              Làm lại
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setIsStartDialogOpen(true)}
              disabled={isGenerating}
              className="h-8"
            >
              <Plus className="h-4 w-4" />
              Tạo mới
            </Button>
          )}

          {isGenerating && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('generating')} ({generationProgress?.progress || 0}%)
            </span>
          )}

          {error && (
            <span className="flex items-center gap-1.5 text-xs text-destructive min-w-0 truncate">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </span>
          )}
        </div>
      )}

      {/* Chọn tài liệu */}
      {showPicker && !isGenerating && (
        <div
          className="shrink-0 border-b border-border bg-background px-3 py-2"
          style={{ maxHeight: '45vh', overflowY: 'auto' }}
        >
          <DocumentPicker
            documents={documents}
            selectedIds={selectedDocIds}
            onChange={setSelectedDocIds}
          />
        </div>
      )}

      {/* Nội dung */}
      <div className="min-h-0 flex-1" style={{ overflow: 'hidden', position: 'relative' }}>
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : isGenerating ? (
          <div className="h-full overflow-auto">
            <QuizGenerating />
          </div>
        ) : currentQuiz ? (
          <div className="h-full overflow-auto">
            {isResultMode ? <QuizResultView /> : <QuizQuestionView />}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {error
              ? 'Xem lỗi trên thanh công cụ và thử lại.'
              : 'Chưa có bộ câu hỏi. Chọn tài liệu rồi bấm "Tạo mới".'}
          </div>
        )}
      </div>

      <QuizStartDialog
        isOpen={isStartDialogOpen}
        onClose={() => setIsStartDialogOpen(false)}
        onStart={(params) => void handleStartGeneration(params)}
      />
    </div>
  )
}
