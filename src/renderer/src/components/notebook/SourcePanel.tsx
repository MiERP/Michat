import { useState, useEffect, useCallback, ReactElement } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  FileText,
  FileUp,
  Loader2,
  StickyNote,
  ArrowLeft,
  FolderUp,
  Pencil,
  RefreshCw
} from 'lucide-react'
import { useKnowledgeStore, setupKnowledgeListeners } from '../../store/knowledgeStore'
import { useItemStore } from '../../store/itemStore'
import { useUIStore } from '../../store/uiStore'
import { ScrollArea } from '../ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Card } from '../ui/card'
import { PanelHeader } from '../ui/panel-header'
import DocumentList from './source/DocumentList'
import type { KnowledgeDocument } from '../../../../shared/types/knowledge'
import type {
  DocumentMetadata,
  DocumentMetadataField,
  DocumentMetadataInspector
} from '../../../../main/services/DocumentMetadataExtractionService'
import { isOriginalLegalDocument } from '../../../../main/services/DocumentMetadataExtractionService'

type AddSourceType = 'text' | 'note'

// 添加来源类型

// 添加来源弹窗组件
interface AddSourceModalProps {
  type: AddSourceType
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: { title?: string; content?: string; noteId?: string }) => void
  isLoading: boolean
  notes: { id: string; title: string }[]
}

function AddSourceModal({
  type,
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  notes
}: AddSourceModalProps) {
  const { t } = useTranslation('ui')
  // 状态会在组件重新挂载时自动重置（通过父组件的 key 属性）
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const [selectedNoteId, setSelectedNoteId] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (type === 'text' && title.trim() && content.trim()) {
      onSubmit({ title, content })
    } else if (type === 'note' && selectedNoteId) {
      onSubmit({ noteId: selectedNoteId })
    }
  }

  // 判断是否可以提交
  const canSubmit =
    !isLoading &&
    ((type === 'text' && title.trim() && content.trim()) || (type === 'note' && selectedNoteId))

  const getTitle = () => {
    if (type === 'text') return t('pasteText')
    if (type === 'note') return t('importNote')
    return ''
  }

  return (
    <Dialog open={isOpen} onOpenChange={isLoading ? undefined : onClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {type === 'text' && (
            <div className="flex flex-col gap-4">
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('documentTitle')}
                className="text-base"
                required
                autoFocus
                disabled={isLoading}
              />
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('textPlaceholder')}
                className="text-base h-60 resize-none"
                required
                disabled={isLoading}
              />
            </div>
          )}

          {type === 'note' && (
            <Select value={selectedNoteId} onValueChange={setSelectedNoteId} disabled={isLoading}>
              <SelectTrigger className="text-base">
                <SelectValue placeholder={t('selectSession')} />
              </SelectTrigger>
              <SelectContent>
                {notes.map((note) => (
                  <SelectItem key={note.id} value={note.id}>
                    {note.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isLoading ? t('processing') : t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface MetadataModalProps {
  document: KnowledgeDocument
  onClose: () => void
  onSaved: () => void
}

const metadataStatusLabels: Record<string, string> = {
  extracted: 'Tự động trích xuất',
  user_corrected: 'Người dùng đã sửa',
  unknown: 'Chưa xác định'
}

function InspectorField({
  label,
  field,
  children
}: {
  label: string
  field?: DocumentMetadataField
  children: React.ReactNode
}): ReactElement {
  return (
    <div className="space-y-1 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-[11px] text-muted-foreground">
          {field ? metadataStatusLabels[field.status] : 'Chưa xác định'}
          {field ? ` · ${Math.round(field.confidence * 100)}%` : ''}
        </span>
      </div>
      {children}
      {field?.evidence && (
        <div className="rounded bg-muted/60 p-2 text-xs text-muted-foreground">
          “{field.evidence.text}”
        </div>
      )}
    </div>
  )
}

function formatMetadataDate(value?: string): string | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function MetadataSummaryField({
  label,
  value,
  field,
  multiline = false
}: {
  label: string
  value?: string
  field?: DocumentMetadataField
  multiline?: boolean
}): ReactElement {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-background/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {field ? metadataStatusLabels[field.status] : 'Chưa xác định'}
          {field ? ` · ${Math.round(field.confidence * 100)}%` : ''}
        </span>
      </div>
      <p
        className={`mt-1 whitespace-pre-wrap text-xs leading-5 ${
          multiline ? 'line-clamp-4' : 'truncate'
        } ${value ? 'text-foreground' : 'text-muted-foreground'}`}
        title={value}
      >
        {value || 'Chưa xác định'}
      </p>
    </div>
  )
}

function MetadataSummaryPanel({
  document,
  onEdit,
  onReextract
}: {
  document: KnowledgeDocument | null
  onEdit: (document: KnowledgeDocument) => void
  onReextract: (document: KnowledgeDocument) => Promise<void>
}): ReactElement {
  const [isReextracting, setIsReextracting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setError(''), [document?.id])

  if (!document) {
    return (
      <section
        className="shrink-0 border-t border-border bg-muted/20 p-4"
        aria-label="Thông tin pháp lý"
      >
        <p className="text-center text-xs text-muted-foreground">
          Chọn tài liệu để xem thông tin pháp lý
        </p>
      </section>
    )
  }

  const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
  const existing = (rootMetadata.documentMetadata as Partial<DocumentMetadata> | undefined) || {}
  const inspector = rootMetadata.documentMetadataInspector as DocumentMetadataInspector | undefined
  const handleReextract = async () => {
    try {
      setIsReextracting(true)
      setError('')
      await onReextract(document)
    } catch (extractError) {
      setError((extractError as Error).message || 'Không thể trích xuất lại thông tin pháp lý.')
    } finally {
      setIsReextracting(false)
    }
  }

  if (!isOriginalLegalDocument(document.content || '')) {
    if (document.mimeType !== 'application/pdf') return <></>
    return (
      <section className="shrink-0 border-t border-border bg-muted/20 px-3 py-2" aria-label="Kiểm tra PDF">
        <p className="text-xs text-muted-foreground">
          Thông tin pháp lý chỉ hiển thị cho văn bản gốc.
        </p>
      </section>
    )
  }

  return (
    <section
      className="max-h-[48%] shrink-0 overflow-y-auto border-t border-border bg-muted/20"
      aria-label="Thông tin pháp lý"
    >
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold">Thông tin pháp lý</h2>
          <p className="truncate text-[11px] text-muted-foreground" title={document.title}>
            {document.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleReextract}
            disabled={isReextracting}
            title="Trích xuất lại thông tin pháp lý"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isReextracting ? 'animate-spin' : ''}`} />
            Trích xuất lại
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onEdit(document)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Chỉnh sửa
          </Button>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <MetadataSummaryField
            label="Số, ký hiệu"
            value={existing.documentNumber || inspector?.fields.documentNumber?.value}
            field={inspector?.fields.documentNumber}
          />
          <MetadataSummaryField
            label="Loại văn bản"
            value={existing.documentType || inspector?.fields.documentType?.value}
            field={inspector?.fields.documentType}
          />
          <MetadataSummaryField
            label="Cơ quan ban hành"
            value={existing.issuer || inspector?.fields.issuer?.value}
            field={inspector?.fields.issuer}
          />
          <MetadataSummaryField
            label="Ngày ban hành"
            value={formatMetadataDate(existing.issuedAt || inspector?.fields.issuedAt?.value)}
            field={inspector?.fields.issuedAt}
          />
        </div>
        <MetadataSummaryField
          label="Tên văn bản"
          value={existing.documentTitle || inspector?.fields.documentTitle?.value}
          field={inspector?.fields.documentTitle}
          multiline
        />
        <MetadataSummaryField
          label="Căn cứ ban hành"
          value={existing.legalBases || inspector?.fields.legalBases?.value}
          field={inspector?.fields.legalBases}
          multiline
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  )
}

function MetadataModal({ document, onClose, onSaved }: MetadataModalProps): ReactElement {
  const rootMetadata = (document.metadata as Record<string, unknown> | null) || {}
  const existing = (rootMetadata.documentMetadata as Partial<DocumentMetadata> | undefined) || {}
  const inspector = rootMetadata.documentMetadataInspector as DocumentMetadataInspector | undefined
  const [form, setForm] = useState<DocumentMetadata>({
    documentNumber: existing.documentNumber,
    documentType: existing.documentType,
    issuer: existing.issuer,
    issuedAt: existing.issuedAt,
    documentTitle: existing.documentTitle,
    legalBases: existing.legalBases
  })
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const updateField = (name: keyof DocumentMetadata, value: string) => {
    setForm((current) => ({ ...current, [name]: value || undefined }))
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      setError('')
      const result = await window.api.knowledge.updateDocumentMetadata(document.id, form)
      if (!result.success) {
        setError(result.error || 'Không thể lưu metadata pháp lý.')
        return
      }
      onSaved()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReextract = async () => {
    try {
      setIsSaving(true)
      setError('')
      const result = await window.api.knowledge.refreshDocumentMetadata(document.id)
      if (!result.success) {
        setError(result.error || 'Không thể trích xuất lại metadata.')
        return
      }
      onSaved()
    } catch (extractError) {
      setError((extractError as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[820px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trình kiểm tra thông tin pháp lý · {document.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Sáu trường đầu văn bản được trích tự động. Có thể kiểm tra bằng chứng và sửa giá trị trước
          khi lưu.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <InspectorField label="Số, ký hiệu" field={inspector?.fields.documentNumber}>
            <Input
              value={form.documentNumber || ''}
              onChange={(event) => updateField('documentNumber', event.target.value)}
              disabled={isSaving}
            />
          </InspectorField>
          <InspectorField label="Loại văn bản" field={inspector?.fields.documentType}>
            <Input
              value={form.documentType || ''}
              onChange={(event) => updateField('documentType', event.target.value)}
              disabled={isSaving}
            />
          </InspectorField>
          <InspectorField label="Cơ quan ban hành" field={inspector?.fields.issuer}>
            <Input
              value={form.issuer || ''}
              onChange={(event) => updateField('issuer', event.target.value)}
              disabled={isSaving}
            />
          </InspectorField>
          <InspectorField label="Ngày ban hành" field={inspector?.fields.issuedAt}>
            <Input
              type="date"
              value={form.issuedAt || ''}
              onChange={(event) => updateField('issuedAt', event.target.value)}
              disabled={isSaving}
            />
          </InspectorField>
        </div>
        <InspectorField label="Tên văn bản" field={inspector?.fields.documentTitle}>
          <Textarea
            value={form.documentTitle || ''}
            onChange={(event) => updateField('documentTitle', event.target.value)}
            className="min-h-20"
            disabled={isSaving}
          />
        </InspectorField>
        <InspectorField label="Căn cứ ban hành" field={inspector?.fields.legalBases}>
          <Textarea
            value={form.legalBases || ''}
            onChange={(event) => updateField('legalBases', event.target.value)}
            className="min-h-32"
            disabled={isSaving}
          />
        </InspectorField>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Hủy
          </Button>
          <Button variant="outline" onClick={handleReextract} disabled={isSaving}>
            Trích xuất lại
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Lưu sửa chữa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 索引进度组件
function IndexingProgress() {
  const { t } = useTranslation('ui')
  const { indexProgress, isIndexing } = useKnowledgeStore()

  if (!isIndexing || !indexProgress) return null

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('indexing')} ({indexProgress.progress}%)
      </div>
    </div>
  )
}

// 文档预览面板组件
interface DocumentViewerPanelProps {
  document: KnowledgeDocument
  onBack: () => void
}

function DocumentViewerPanel({ document, onBack }: DocumentViewerPanelProps) {
  const { t } = useTranslation('ui')
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  // 加载文档内容
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true)
      try {
        const chunks = await window.api.knowledge.getDocumentChunks(document.id)
        // 合并所有 chunk 的内容
        const fullContent = chunks.map((chunk) => chunk.content).join('\n\n')
        setContent(fullContent)
      } catch (error) {
        console.error('Error loading document content:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadContent()
  }, [document.id])

  return (
    <>
      <PanelHeader
        draggable
        left={
          <Button
            onClick={onBack}
            variant="ghost"
            size="icon"
            className="w-8 h-8"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={t('backToList')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        }
        center={<span className="text-sm font-medium truncate">{document.title}</span>}
      />

      {/* 文档内容 */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-6">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{content}</pre>
            </div>
          </div>
        )}
      </ScrollArea>
    </>
  )
}

export default function SourcePanel(): ReactElement {
  const { t } = useTranslation('ui')
  const { id: notebookId } = useParams()
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [modalType, setModalType] = useState<AddSourceType | null>(null)
  const [defaultEmbeddingModel, setDefaultEmbeddingModel] = useState<string | undefined>(undefined)
  const [openedDocument, setOpenedDocument] = useState<KnowledgeDocument | null>(null)
  const [inspectedDocumentId, setInspectedDocumentId] = useState<string | null>(null)
  const [metadataDocument, setMetadataDocument] = useState<KnowledgeDocument | null>(null)

  const {
    documents,
    isLoading,
    isIndexing,
    loadDocuments,
    loadStats,
    addDocument,
    addDocumentFromFile,
    addDocumentsFromFolder,
    addNoteToKnowledge,
    deleteDocument,
    selectFiles,
    selectFolder
  } = useKnowledgeStore()

  const { notes, loadNotes } = useItemStore()

  const { openSettings } = useUIStore()
  const inspectedDocument =
    documents.find((document) => document.id === inspectedDocumentId) || null

  // 加载默认嵌入模型设置
  useEffect(() => {
    const loadEmbeddingModel = async () => {
      const model = await window.api.settings.get('defaultEmbeddingModel')
      setDefaultEmbeddingModel(model)
    }
    loadEmbeddingModel()

    // 监听设置变化
    const unsubscribe = window.api.settings.onSettingsChange((newSettings) => {
      setDefaultEmbeddingModel(newSettings.defaultEmbeddingModel)
    })

    return unsubscribe
  }, [])

  // 设置监听器
  useEffect(() => {
    const cleanup = setupKnowledgeListeners()
    return cleanup
  }, [])

  // 加载文档和笔记
  useEffect(() => {
    if (notebookId) {
      loadDocuments(notebookId)
      loadStats(notebookId)
      loadNotes(notebookId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId])

  // 当 notebook 切换时清空选中的文档
  useEffect(() => {
    setOpenedDocument(null)
    setInspectedDocumentId(null)
    setMetadataDocument(null)
  }, [notebookId])

  useEffect(() => {
    if (inspectedDocumentId && !documents.some((document) => document.id === inspectedDocumentId)) {
      setInspectedDocumentId(null)
    }
  }, [documents, inspectedDocumentId])

  // 处理文件上传
  const handleFileUpload = useCallback(async () => {
    if (!notebookId) return

    // 检查是否配置了默认嵌入模型
    if (!defaultEmbeddingModel) {
      alert(t('noEmbeddingModelConfigured'))
      return
    }

    const files = await selectFiles()
    for (const filePath of files) {
      await addDocumentFromFile(notebookId, filePath)
    }
    setShowAddMenu(false)
  }, [notebookId, defaultEmbeddingModel, selectFiles, addDocumentFromFile, t])

  // 处理文件夹上传
  const handleFolderUpload = useCallback(async () => {
    if (!notebookId) return

    if (!defaultEmbeddingModel) {
      alert(t('noEmbeddingModelConfigured'))
      return
    }

    const folderPath = await selectFolder()
    if (!folderPath) {
      setShowAddMenu(false)
      return
    }

    const result = await addDocumentsFromFolder(notebookId, folderPath)
    if (result.success && result.result && result.result.failedFiles.length > 0) {
      alert(
        `${t('folderImportResult', {
          indexed: result.result.indexedFiles,
          total: result.result.totalFiles,
          failed: result.result.failedFiles.length
        })}`
      )
    }

    setShowAddMenu(false)
  }, [notebookId, defaultEmbeddingModel, selectFolder, addDocumentsFromFolder, t, setShowAddMenu])

  // 处理文本粘贴
  const handleTextPaste = useCallback(
    async (data: { title?: string; content?: string }) => {
      if (!notebookId || !data.title || !data.content) return

      // 检查是否配置了默认嵌入模型
      if (!defaultEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      await addDocument(notebookId, {
        title: data.title,
        type: 'text',
        content: data.content
      })
      setModalType(null)
    },
    [notebookId, defaultEmbeddingModel, addDocument, t]
  )

  // 处理笔记导入
  const handleNoteImport = useCallback(
    async (data: { noteId?: string }) => {
      if (!notebookId || !data.noteId) return

      // 检查是否配置了默认嵌入模型
      if (!defaultEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      try {
        await addNoteToKnowledge(notebookId, data.noteId)
        setModalType(null)
      } catch (error) {
        // 检查是否是空笔记错误
        const errorMessage = (error as Error).message || ''
        if (errorMessage.toLowerCase().includes('empty')) {
          alert(t('emptyNoteCannotImport'))
        } else {
          alert(errorMessage || t('embeddingFailed', { title: '' }))
        }
        setModalType(null)
      }
    },
    [notebookId, defaultEmbeddingModel, addNoteToKnowledge, t]
  )

  // 处理删除文档
  const handleDelete = useCallback(
    async (documentId: string) => {
      if (!notebookId) return
      const deletedIndex = documents.findIndex((document) => document.id === documentId)
      const nextDocument = documents[deletedIndex + 1] || documents[deletedIndex - 1] || null
      await deleteDocument(notebookId, documentId)
      if (inspectedDocumentId === documentId) {
        setInspectedDocumentId(nextDocument?.id || null)
      }
    },
    [notebookId, documents, inspectedDocumentId, deleteDocument]
  )

  // 处理打开设置
  const handleOpenSettings = useCallback(() => {
    openSettings()
  }, [openSettings])

  // 处理打开源文件
  const handleOpenSource = useCallback(
    async (documentId: string) => {
      try {
        const result = await window.api.knowledge.openSource(documentId)
        if (!result?.success) {
          alert(result?.error || t('operationFailed'))
        }
      } catch (error) {
        console.error('Error opening source:', error)
      }
    },
    [t]
  )

  const handleInspectDocument = useCallback((document: KnowledgeDocument) => {
    setInspectedDocumentId(document.id)
  }, [])

  // 双击或按 Enter 时打开文档
  const handleOpenDocument = useCallback(
    (document: KnowledgeDocument) => {
      // 文本和笔记类型可以预览，直接显示预览页面
      if (document.type === 'text' || document.type === 'note') {
        setOpenedDocument(document)
      } else {
        // 其他类型（文件、URL）直接打开
        handleOpenSource(document.id)
      }
    },
    [handleOpenSource]
  )

  // 返回列表
  const handleBack = useCallback(() => {
    setOpenedDocument(null)
  }, [])

  const handleReextractMetadata = useCallback(
    async (document: KnowledgeDocument) => {
      const result = await window.api.knowledge.refreshDocumentMetadata(document.id)
      if (!result.success) {
        throw new Error(result.error || 'Không thể trích xuất lại thông tin pháp lý.')
      }
      if (notebookId) await loadDocuments(notebookId)
    },
    [notebookId, loadDocuments]
  )

  // 处理弹窗提交
  const handleModalSubmit = useCallback(
    (data: { title?: string; content?: string; noteId?: string }) => {
      if (modalType === 'text') {
        handleTextPaste(data)
      } else if (modalType === 'note') {
        handleNoteImport(data)
      }
    },
    [modalType, handleTextPaste, handleNoteImport]
  )

  return (
    <Card className="flex flex-col rounded-xl border-0 overflow-hidden h-full shadow-md">
      {openedDocument ? (
        // 文档预览页面
        <DocumentViewerPanel
          key={openedDocument.id}
          document={openedDocument}
          onBack={handleBack}
        />
      ) : (
        // 文档列表页面
        <>
          <PanelHeader
            draggable
            left={<span className="text-sm text-foreground">{t('knowledgeBase')}</span>}
            right={
              <div
                className="relative"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  disabled={!defaultEmbeddingModel}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  title={!defaultEmbeddingModel ? t('noEmbeddingModelConfigured') : t('addSource')}
                >
                  <Plus className="w-4 h-4" />
                </Button>

                {/* 添加菜单 */}
                {showAddMenu && (
                  <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-10">
                    <Button
                      onClick={handleFileUpload}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal rounded-none"
                    >
                      <FileUp className="w-4 h-4" />
                      {t('uploadFile')}
                    </Button>
                    <Button
                      onClick={handleFolderUpload}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal rounded-none"
                    >
                      <FolderUp className="w-4 h-4" />
                      {t('uploadFolder')}
                    </Button>
                    <Button
                      onClick={() => {
                        setModalType('text')
                        setShowAddMenu(false)
                      }}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal rounded-none"
                    >
                      <FileText className="w-4 h-4" />
                      {t('pasteText')}
                    </Button>
                    <Button
                      onClick={() => {
                        setModalType('note')
                        setShowAddMenu(false)
                      }}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal rounded-none"
                    >
                      <StickyNote className="w-4 h-4" />
                      {t('importNote')}
                    </Button>
                  </div>
                )}
              </div>
            }
          />

          {/* 索引进度 */}
          <IndexingProgress />

          {/* 文档列表 */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <ScrollArea className="min-h-0 flex-1">
                <DocumentList
                  documents={documents}
                  hasEmbeddingModel={!!defaultEmbeddingModel}
                  selectedDocumentId={inspectedDocumentId}
                  onDeleteDocument={handleDelete}
                  onSelectDocument={handleInspectDocument}
                  onOpenDocument={handleOpenDocument}
                  onOpenSettings={handleOpenSettings}
                />
              </ScrollArea>
              <MetadataSummaryPanel
                document={inspectedDocument}
                onEdit={setMetadataDocument}
                onReextract={handleReextractMetadata}
              />
            </div>
          )}
        </>
      )}

      {/* 添加来源弹窗 - 使用 key 强制在 type 变化时重新挂载组件 */}
      {modalType && (
        <AddSourceModal
          key={modalType}
          type={modalType}
          isOpen={true}
          onClose={() => setModalType(null)}
          onSubmit={handleModalSubmit}
          isLoading={isIndexing}
          notes={notes
            .filter((n) => n.content.trim().length > 0)
            .map((n) => ({ id: n.id, title: n.title }))}
        />
      )}

      {metadataDocument && (
        <MetadataModal
          document={metadataDocument}
          onClose={() => setMetadataDocument(null)}
          onSaved={async () => {
            if (notebookId) await loadDocuments(notebookId)
            setMetadataDocument(null)
          }}
        />
      )}

      {/* 点击外部关闭菜单 */}
      {showAddMenu && <div className="fixed inset-0 z-0" onClick={() => setShowAddMenu(false)} />}
    </Card>
  )
}
