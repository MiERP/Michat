import { ReactElement, useEffect, useRef, useState } from 'react'
import {
  Save,
  Trash2,
  ArrowLeft,
  FileText,
  BookOpenText,
  ExternalLink,
  Loader2,
  ClipboardList,
  Presentation,
  ThumbsUp,
  ThumbsDown,
  PenLine,
  Filter
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { useItemStore } from '../../store/itemStore'
import { useCitationStore } from '../../store/citationStore'
import { useChatStore } from '../../store/chatStore'
import NoteEditor from './note/NoteEditor'
import ItemList from './item/ItemList'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PanelHeader } from '../ui/panel-header'
import UnsavedChangesDialog from '../common/UnsavedChangesDialog'
import DeleteNoteConfirmDialog from '../common/DeleteNoteConfirmDialog'
import type { Note } from '../../../../shared/types'

// 编辑器面板子组件 - 管理编辑状态
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

  // 检测是否有未保存的修改
  useEffect(() => {
    const hasChanges = editTitle !== note.title || editContent !== note.content
    onUnsavedChange(hasChanges)
  }, [editTitle, editContent, note.title, note.content, onUnsavedChange])

  const handleSave = () => {
    // 如果标题为空或只有空格，使用默认标题
    const finalTitle = editTitle.trim() || t('untitledNote')
    // 更新显示的标题，让用户看到自动设置的标题
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
  const { setRagScope } = useChatStore()
  const visibleItems = items

  // Giới hạn phạm vi hỏi vào đúng MỤC (heading) chứa đoạn trích dẫn
  const handleScopeToSection = (): void => {
    if (!selected) return
    setRagScope({
      documentIds: [selected.citation.documentId],
      sectionPath: selected.citation.sectionPath
    })
  }

  // Giới hạn phạm vi hỏi vào đúng TRANG chứa đoạn trích dẫn
  const handleScopeToPage = (): void => {
    if (!selected?.pageNumber) return
    setRagScope({
      documentIds: [selected.citation.documentId],
      pageRange: { from: selected.pageNumber, to: selected.pageNumber }
    })
  }

  // Auto-scroll tới đoạn trích dẫn chính khi mở citation
  const citationContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selected) return
    // Đợi render xong rồi cuộn tới mark (đoạn chính được LLM dùng)
    const timer = setTimeout(() => {
      const mark = citationContentRef.current?.querySelector('mark')
      mark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 50)
    return () => clearTimeout(timer)
  }, [selected])

  // 管理未保存状态
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Dialog 状态管理
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // 监听Notebook切换，清空当前编辑状态
  useEffect(() => {
    if (notebookId) {
      // 清空当前编辑状态，避免显示旧Notebook的内容
      setCurrentNote(null)
      clearCitation()
      // 使用 setTimeout 将状态更新推迟到下一个事件循环
      setTimeout(() => setHasUnsavedChanges(false), 0)
    }
  }, [notebookId, setCurrentNote, clearCitation])

  // 加载 items 列表
  useEffect(() => {
    if (notebookId) {
      loadItems(notebookId)
    }
  }, [notebookId, loadItems])

  // Quiz được tạo xong ở cửa sổ popup → refresh danh sách để hiện bộ câu hỏi mới
  useEffect(() => {
    if (!notebookId) return
    const cleanup = window.api.quiz.onGenerated((data) => {
      if (data.notebookId === notebookId) {
        void loadItems(notebookId)
      }
    })
    return cleanup
  }, [notebookId, loadItems])

  // 创建新笔记
  const handleCreateNote = async () => {
    if (!notebookId) return
    await createNote(notebookId, t('newNoteContent'), t('newNote'))
  }

  // 保存笔记
  const handleSave = async (title: string, content: string) => {
    if (!currentNote) return
    await updateNote(currentNote.id, { title, content })
  }

  // 删除笔记
  const handleDelete = async () => {
    if (!currentNote) return
    setShowDeleteDialog(true)
  }

  // 确认删除笔记
  const confirmDelete = async () => {
    if (!currentNote) return
    // 找到对应的 item
    const item = items.find((item) => item.type === 'note' && item.resourceId === currentNote.id)
    if (item) {
      await deleteItem(item.id, true) // 同时删除资源
    }
  }

  // 返回列表页面
  const handleBack = () => {
    // 如果有未保存的修改，提示用户
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true)
      return
    }
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  // 确认离开（有未保存修改时）
  const confirmLeave = () => {
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  // 打开答题窗口（查看特定版本）
  const handleOpenQuiz = async (quizId: string) => {
    try {
      if (notebookId) {
        await window.api.quiz.openWindow(notebookId, quizId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open quiz window:', error)
    }
  }

  // 打开答题窗口（tạo mới — chưa có quizId)
  const handleOpenQuizWindow = async () => {
    if (!notebookId) return
    try {
      await window.api.quiz.openWindow(notebookId)
    } catch (error) {
      console.error('[NotePanel] Failed to open quiz window:', error)
    }
  }

  // Open the Office assistant window (Word / Excel / PowerPoint)
  const handleOpenOfficeWindow = async () => {
    if (!notebookId) return
    try {
      await window.api.office.openWindow(notebookId)
    } catch (error) {
      console.error('[NotePanel] Failed to open office window:', error)
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

  // Feedback loop: ghi nhận đánh giá của người dùng lên citation
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null)
  const handleRecordFeedback = async (
    kind: 'citation_good' | 'citation_bad' | 'user_correction'
  ) => {
    if (!notebookId || !selected?.citation?.chunkId) return

    let note: string | undefined
    if (kind === 'user_correction') {
      const correction = window.prompt(
        'Nội dung đúng là gì? (sẽ được dùng để giảm trọng số chunk này)'
      )
      if (correction === null) return
      note = correction
    }

    try {
      const result = await window.api.knowledge.recordFeedback(
        notebookId,
        selected.citation.chunkId,
        kind,
        note
      )
      if (result?.success) {
        setFeedbackSent(kind)
        setTimeout(() => setFeedbackSent(null), 2000)
      } else {
        alert(result?.error || 'Không thể ghi nhận phản hồi')
      }
    } catch (error) {
      console.error('[NotePanel] Failed to record feedback:', error)
    }
  }

  return (
    <div className="flex flex-col bg-card rounded-xl overflow-hidden h-full shadow-md">
      {isEditing && currentNote ? (
        // 编辑器页面 - 使用 key 强制在切换笔记时重新挂载
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
        // 列表页面
        <>
          {/* 顶部工具栏 */}
          <PanelHeader
            draggable
            left={<span className="text-sm text-foreground">{t('creativeSpace')}</span>}
            right={
              <>
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
                <Button
                  onClick={handleOpenQuizWindow}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('generateQuiz')}
                >
                  <ClipboardList className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleOpenOfficeWindow}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title="Office"
                >
                  <Presentation className="w-4 h-4" />
                </Button>
              </>
            }
          />

          {/* Items 列表（上半） + Citation 预览（下半） */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="basis-1/2 min-h-[180px] border-b border-border">
              <ScrollArea className="h-full">
                <ItemList
                  items={visibleItems}
                  currentNote={currentNote}
                  onSelectNote={setCurrentNote}
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
                      {selected.citation.sectionPath?.length ? (
                        <div className="truncate" title={selected.citation.sectionPath.join(' › ')}>
                          Mục: {selected.citation.sectionPath.join(' › ')}
                        </div>
                      ) : null}
                      <div>ID tài liệu: {selected.citation.documentId}</div>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-4" ref={citationContentRef}>
                        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground font-sans">
                          {selected.prevContent && (
                            <>
                              <span className="text-muted-foreground select-none">
                                — Văn cảnh trước —
                              </span>
                              {'\n'}
                              <span className="text-muted-foreground/80">
                                {selected.prevContent}
                              </span>
                              {'\n\n'}
                            </>
                          )}
                          {selected.chunkContent && (
                            <>
                              <span className="text-primary select-none">
                                — Đoạn trích dẫn được LLM sử dụng —
                              </span>
                              {'\n'}
                              <mark className="bg-yellow-300/60 text-foreground rounded-sm px-0.5">
                                {selected.chunkContent}
                              </mark>
                              {'\n\n'}
                            </>
                          )}
                          {selected.nextContent && (
                            <>
                              <span className="text-muted-foreground select-none">
                                — Văn cảnh sau —
                              </span>
                              {'\n'}
                              <span className="text-muted-foreground/80">
                                {selected.nextContent}
                              </span>
                            </>
                          )}
                          {!selected.prevContent &&
                            !selected.chunkContent &&
                            !selected.nextContent &&
                            renderHighlightedText(
                              selected.documentContent || selected.citation.snippet,
                              selected.highlightText
                            )}
                        </pre>
                      </div>
                    </ScrollArea>
                    <div className="px-4 py-2 border-t border-border flex items-center gap-2">
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
                      {selected.citation.sectionPath?.length ? (
                        <Button
                          onClick={handleScopeToSection}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Chỉ hỏi trong mục này"
                          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        >
                          <Filter className="w-3 h-3" />
                        </Button>
                      ) : null}
                      {selected.pageNumber ? (
                        <Button
                          onClick={handleScopeToPage}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Chỉ hỏi trong trang này"
                          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        >
                          <Filter className="w-3 h-3" />
                        </Button>
                      ) : null}
                      <div className="flex-1" />
                      <span className="text-xs text-muted-foreground">Đánh giá trích dẫn:</span>
                      <Button
                        onClick={() => handleRecordFeedback('citation_good')}
                        variant="ghost"
                        size="sm"
                        className={`h-8 px-2 text-xs ${feedbackSent === 'citation_good' ? 'text-green-600' : ''}`}
                        title="Trích dẫn chính xác"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <ThumbsUp className="w-3 h-3" />
                      </Button>
                      <Button
                        onClick={() => handleRecordFeedback('citation_bad')}
                        variant="ghost"
                        size="sm"
                        className={`h-8 px-2 text-xs ${feedbackSent === 'citation_bad' ? 'text-destructive' : ''}`}
                        title="Trích dẫn không liên quan/sai"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <ThumbsDown className="w-3 h-3" />
                      </Button>
                      <Button
                        onClick={() => handleRecordFeedback('user_correction')}
                        variant="ghost"
                        size="sm"
                        className={`h-8 px-2 text-xs ${feedbackSent === 'user_correction' ? 'text-blue-600' : ''}`}
                        title="Sửa nội dung sai"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <PenLine className="w-3 h-3" />
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
    </div>
  )
}

function renderHighlightedText(content: string, highlightText?: string) {
  if (!highlightText || !content) return content

  const target = stripEllipsis(highlightText.trim())
  if (!target || target.length < 20) return content

  const match = findFlexibleMatch(content, target)
  if (!match) return content

  return (
    <>
      {content.slice(0, match.start)}
      <mark className="bg-yellow-300/50 text-foreground px-0.5 rounded-sm">
        {content.slice(match.start, match.end)}
      </mark>
      {content.slice(match.end)}
    </>
  )
}

/**
 * Tìm vị trí khớp linh hoạt: bỏ qua khác biệt whitespace (snippet đã bị
 * collapse khoảng trắng trong khi nội dung preview giữ nguyên xuống dòng).
 * Trả về index theo chuỗi gốc (cùng độ dài với bản lowercase).
 */
function findFlexibleMatch(source: string, target: string): { start: number; end: number } | null {
  const lowerSource = source.toLowerCase()
  const lowerTarget = target.toLowerCase()

  const exact = lowerSource.indexOf(lowerTarget)
  if (exact >= 0) {
    return { start: exact, end: exact + lowerTarget.length }
  }

  const escaped = lowerTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const flexible = new RegExp(escaped.replace(/\s+/g, '\\s+'))
  const match = flexible.exec(lowerSource)
  if (!match) return null

  return { start: match.index, end: match.index + match[0].length }
}

function stripEllipsis(text: string): string {
  return text.replace(/\.\.\.+$/, '').trim()
}
