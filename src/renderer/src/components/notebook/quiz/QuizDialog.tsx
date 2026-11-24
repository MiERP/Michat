import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog'
import { Button } from '../../ui/button'
import { useDraggableDialog } from '../../ui/useDraggableDialog'
import { RefreshCw, Loader2, ArrowLeft, ChevronDown, ChevronUp, Files } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuizStore } from '../../../store/quizStore'
import { useKnowledgeStore } from '../../../store/knowledgeStore'
import { ScrollArea } from '../../ui/scroll-area'
import DocumentPicker from '../source/DocumentPicker'
import QuizGenerating from './QuizGenerating'
import QuizQuestionView from './QuizQuestionView'
import QuizResultView from './QuizResultView'

export default function QuizDialog({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation('quiz')
  const { contentRef, startDrag, dragStyle } = useDraggableDialog()
  const {
    isDialogOpen,
    setDialogOpen,
    currentQuiz,
    isGenerating,
    generationProgress,
    generateQuiz,
    isResultMode
  } = useQuizStore()
  const { documents, loadDocuments } = useKnowledgeStore()

  // Chọn tài liệu: rỗng = tất cả
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    if (isDialogOpen && notebookId) {
      setSelectedDocIds([])
      setShowPicker(false)
      void loadDocuments(notebookId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDialogOpen, notebookId])

  const handleGenerate = async () => {
    if (notebookId) {
      try {
        await generateQuiz(notebookId, {
          documentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined
        })
      } catch (error) {
        console.error('Failed to generate quiz:', error)
      }
    }
  }

  const handleClose = () => {
    setDialogOpen(false)
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent
        ref={contentRef}
        className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0"
        style={{
          display: 'flex',
          flexDirection: 'column',
          ...dragStyle
        }}
      >
        {/* Header - fixed height */}
        <div
          className="p-6 pb-4 border-b border-border cursor-move select-none"
          style={{
            flexShrink: 0
          }}
          onMouseDown={startDrag}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleClose}
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                type="button"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <DialogTitle>{t('quiz')}</DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              {!isGenerating && (
                <Button
                  onClick={() => setShowPicker(!showPicker)}
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  type="button"
                  title="Chọn tài liệu để tạo"
                >
                  <Files className="w-4 h-4 mr-1" />
                  {selectedDocIds.length > 0
                    ? `${selectedDocIds.length} tài liệu`
                    : 'Tất cả tài liệu'}
                  {showPicker ? (
                    <ChevronUp className="w-3 h-3 ml-1" />
                  ) : (
                    <ChevronDown className="w-3 h-3 ml-1" />
                  )}
                </Button>
              )}
              {!currentQuiz && !isGenerating && (
                <Button onClick={handleGenerate} size="sm">
                  {t('generateQuiz')}
                </Button>
              )}
              {currentQuiz && !isGenerating && !isResultMode && (
                <Button onClick={handleGenerate} size="sm" variant="outline">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('generateQuiz')}
                </Button>
              )}
              {isGenerating && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('generating')} ({generationProgress?.progress || 0}%)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chọn tài liệu */}
        {showPicker && !isGenerating && (
          <div
            className="border-b border-border px-6 py-3"
            style={{ flexShrink: 0, maxHeight: '45vh', overflowY: 'auto' }}
          >
            <DocumentPicker
              documents={documents}
              selectedIds={selectedDocIds}
              onChange={setSelectedDocIds}
            />
          </div>
        )}

        {/* Content area - fills the remaining space automatically */}
        <ScrollArea className="flex-1 p-6">
          {isGenerating ? (
            <QuizGenerating />
          ) : currentQuiz ? (
            isResultMode ? (
              <QuizResultView />
            ) : (
              <QuizQuestionView />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {t('noQuizYet')}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
