import { ReactElement, useEffect, useState } from 'react'
import {
  Save,
  Trash2,
  ArrowLeft,
  FileText,
  ClipboardCheck,
  BookOpenText,
  ExternalLink,
  Loader2,
  Podcast,
  XCircle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { useItemStore } from '../../store/itemStore'
import { useCitationStore } from '../../store/citationStore'
import NoteEditor from './note/NoteEditor'
import ItemList from './item/ItemList'
import QuizStartDialog, { QuizStartParams } from './quiz/QuizStartDialog'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PanelHeader } from '../ui/panel-header'
import UnsavedChangesDialog from '../common/UnsavedChangesDialog'
import DeleteNoteConfirmDialog from '../common/DeleteNoteConfirmDialog'
import type { Note } from '../../../../shared/types'

interface NoteEditorPanelProps {
  note: Note
  isSaving: boolean
  onSave: (title: string, content: string) => void
  onDelete: () => void
  onBack: () => void
  hasUnsavedChanges: boolean
  onUnsavedChange: (hasChanges: boolean) => void
}

function NoteEditorPanel({
  note,
  isSaving,
  onSave,
  onDelete,
  onBack,
  onUnsavedChange
}: NoteEditorPanelProps) {
  const { t } = useTranslation('notebook')
  const [editTitle, setEditTitle] = useState(note.title)
  const [editContent, setEditContent] = useState(note.content)

  useEffect(() => {
    const hasChanges = editTitle !== note.title || editContent !== note.content
    onUnsavedChange(hasChanges)
  }, [editTitle, editContent, note.title, note.content, onUnsavedChange])

  const handleSave = () => {
    const finalTitle = editTitle.trim() || t('untitledNote')
    if (!editTitle.trim()) {
      setEditTitle(finalTitle)
    }
    onSave(finalTitle, editContent)
  }

  return (
    <>
      <PanelHeader
        draggable
        left={
          <Button
            onClick={onBack}
            variant="ghost"
            size="icon"
            className="w-8 h-8 shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={t('backToList')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        }
        center={
          <Input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="bg-transparent border-0 text-sm font-medium p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            placeholder={t('noteTitle')}
          />
        }
        right={
          <>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              variant="ghost"
              size="icon"
              className="w-8 h-8"
              title={t('save')}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Save className="w-4 h-4" />
            </Button>
            <Button
              onClick={onDelete}
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title={t('delete')}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        }
      />

      {/* 编辑器内容 */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor content={editContent} onChange={setEditContent} />
      </div>
    </>
  )
}

export default function NotePanel(): ReactElement {
  const { t } = useTranslation('notebook')
  const { id: notebookId } = useParams()
  const {
    items,
    currentNote,
    isEditing,
    isSaving,
    loadItems,
    createNote,
    updateNote,
    deleteItem,
    setCurrentNote
  } = useItemStore()
  const { selected, isLoading, clearCitation } = useCitationStore()
  const visibleItems = items.filter((item) => item.type !== 'mindmap')

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showQuizStartDialog, setShowQuizStartDialog] = useState(false)
  const [podcastProgress, setPodcastProgress] = useState<{ stage: string; progress: number } | null>(null)

  useEffect(() => {
    if (notebookId) {
      setCurrentNote(null)
      clearCitation()
      setTimeout(() => setHasUnsavedChanges(false), 0)
    }
  }, [notebookId, setCurrentNote, clearCitation])

  useEffect(() => {
    if (notebookId) {
      loadItems(notebookId)
    }
  }, [notebookId, loadItems])

  useEffect(() => {
    if (!window.api.podcast?.onProgress) return

    return window.api.podcast.onProgress((data) => {
      if (data.notebookId === notebookId) {
        setPodcastProgress({ stage: data.stage, progress: data.progress })
      }
    })
  }, [notebookId])

  const handleCreateNote = async () => {
    if (!notebookId) return
    await createNote(notebookId, t('newNoteContent'), t('newNote'))
  }

  const handleSave = async (title: string, content: string) => {
    if (!currentNote) return
    await updateNote(currentNote.id, { title, content })
  }

  const handleDelete = async () => {
    if (!currentNote) return
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!currentNote) return
    const item = items.find((item) => item.type === 'note' && item.resourceId === currentNote.id)
    if (item) {
      await deleteItem(item.id, true) // 同时删除资源
    }
  }

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true)
      return
    }
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  const confirmLeave = () => {
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  const handleOpenQuiz = async (quizId: string) => {
    try {
      if (notebookId) {
        await window.api.quiz.openWindow(notebookId, quizId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open quiz window:', error)
    }
  }

  const handleGenerateQuiz = () => {
    setShowQuizStartDialog(true)
  }

  const handleGeneratePodcast = async () => {
    if (!notebookId || podcastProgress) return
    setPodcastProgress({ stage: 'starting', progress: 1 })

    if (!window.api.podcast?.generateScript) {
      console.error('[NotePanel] Podcast API is not available')
      setPodcastProgress(null)
      return
    }

    const result = await window.api.podcast.generateScript(notebookId)
    if (result.success) {
      await loadItems(notebookId)
    } else if (!result.cancelled) {
      console.error('[NotePanel] Podcast generation failed:', result.error)
    }
    setPodcastProgress(null)
  }

  const handleCancelPodcast = async () => {
    if (!notebookId) return
    await window.api.podcast?.cancel?.(notebookId)
    setPodcastProgress(null)
  }

  const handleQuizStart = async (params: QuizStartParams) => {
    if (!notebookId) return
    try {
      window.api.quiz
        .generate(notebookId, {
          questionCount: params.questionCount,
          difficulty: params.difficulty,
          customPrompt: params.customPrompt
        })
        .then((result) => {
          if (result.success) {
            loadItems(notebookId)
          }
        })

      setTimeout(() => {
        loadItems(notebookId)
      }, 500)
    } catch (error) {
      console.error('[NotePanel] Failed to start quiz:', error)
    }
  }

  const handleOpenCitationSource = async () => {
    if (!selected?.citation?.documentId) return
    try {
      const result = await window.api.knowledge.openSource(selected.citation.documentId)
      if (!result?.success) {
        alert(result?.error || 'Không thể mở nguồn gốc tài liệu')
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open citation source:', error)
    }
  }

  return (
    <div className="flex flex-col bg-card rounded-xl overflow-hidden h-full shadow-md">
      {isEditing && currentNote ? (
        <NoteEditorPanel
          key={currentNote.id}
          note={currentNote}
          isSaving={isSaving}
          onSave={handleSave}
          onDelete={handleDelete}
          onBack={handleBack}
          hasUnsavedChanges={hasUnsavedChanges}
          onUnsavedChange={setHasUnsavedChanges}
        />
      ) : (
        <>
          {/* 顶部工具栏 */}
          <PanelHeader
            draggable
            left={<span className="text-sm text-foreground">{t('creativeSpace')}</span>}
            right={
              <>
                <Button
                  onClick={handleGenerateQuiz}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('generateQuiz')}
                >
                  <ClipboardCheck className="w-4 h-4" />
                </Button>
                <Button
                  onClick={podcastProgress ? handleCancelPodcast : handleGeneratePodcast}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={podcastProgress ? 'Cancel podcast script' : 'Generate podcast script'}
                >
                  {podcastProgress ? (
                    <XCircle className="w-4 h-4 text-destructive" />
                  ) : (
                    <Podcast className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  onClick={handleCreateNote}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('createNote')}
                >
                  <FileText className="w-4 h-4" />
                </Button>
              </>
            }
          />

          {/* Items 列表（上半） + Citation 预览（下半） */}
          <div className="flex-1 min-h-0 flex flex-col">
            {podcastProgress && (
              <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground" role="status">
                <div className="flex items-center justify-between gap-3">
                  <span>Podcast: {podcastProgress.stage}</span>
                  <span>{Math.round(podcastProgress.progress)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.max(1, Math.min(100, podcastProgress.progress))}%` }}
                  />
                </div>
              </div>
            )}
            <div className="basis-1/2 min-h-[180px] border-b border-border">
              <ScrollArea className="h-full">
                <ItemList
                  items={visibleItems}
                  currentNote={currentNote}
                  onSelectNote={setCurrentNote}
                  onOpenMindMap={() => {}}
                  onOpenQuiz={handleOpenQuiz}
                  onDeleteItem={(itemId) => deleteItem(itemId, true)}
                  onRefresh={() => notebookId && loadItems(notebookId)}
                />
              </ScrollArea>
            </div>

            <div className="basis-1/2 min-h-[180px] flex flex-col">
              <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <BookOpenText className="w-4 h-4" />
                  <span>Trích dẫn nguồn</span>
                </div>
                {selected && (
                  <Button
                    onClick={clearCitation}
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  >
                    Ẩn
                  </Button>
                )}
              </div>

              <div className="flex-1 min-h-0">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : selected ? (
                  <div className="h-full flex flex-col">
                    <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                      <div>
                        [{selected.citation.index}] {selected.citation.documentTitle}
                        {selected.pageNumber ? ` (trang ${selected.pageNumber})` : ''}
                      </div>
                      <div>ID tài liệu: {selected.citation.documentId}</div>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-4">
                        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground font-sans">
                          {renderHighlightedText(
                            selected.documentContent || selected.citation.snippet,
                            selected.highlightText
                          )}
                        </pre>
                      </div>
                    </ScrollArea>
                    <div className="px-4 py-2 border-t border-border">
                      <Button
                        onClick={handleOpenCitationSource}
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <ExternalLink className="w-3 h-3" />
                        Mở nguồn gốc
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
                    Chọn chỉ mục citation [n] trong câu trả lời để xem đoạn trích.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 未保存修改确认对话框 */}
      <UnsavedChangesDialog
        isOpen={showUnsavedDialog}
        onClose={() => setShowUnsavedDialog(false)}
        onConfirm={confirmLeave}
      />

      {/* 删除笔记确认对话框 */}
      <DeleteNoteConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={confirmDelete}
      />

      {/* 答题启动对话框 */}
      {notebookId && (
        <QuizStartDialog
          isOpen={showQuizStartDialog}
          onClose={() => setShowQuizStartDialog(false)}
          onStart={handleQuizStart}
        />
      )}
    </div>
  )
}

function renderHighlightedText(content: string, highlightText?: string) {
  if (!highlightText || !content) return content

  const source = content
  const target = highlightText.trim()
  if (!target) return content

  const lowerSource = source.toLowerCase()
  const lowerTarget = target.toLowerCase()
  const start = lowerSource.indexOf(lowerTarget)
  if (start < 0) return content

  const end = start + target.length

  return (
    <>
      {source.slice(0, start)}
      <mark className="bg-yellow-300/50 text-foreground px-0.5 rounded-sm">
        {source.slice(start, end)}
      </mark>
      {source.slice(end)}
    </>
  )
}
