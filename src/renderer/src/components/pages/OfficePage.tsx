import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
  Loader2,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  ExternalLink
} from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { ScrollArea } from '../ui/scroll-area'
import { PanelHeader } from '../ui/panel-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { Note } from '../../../../shared/types'
import type { KnowledgeDocument } from '../../../../shared/types/knowledge'
type OfficeDocumentKind = 'docx' | 'xlsx' | 'pptx'

// Phải khớp OFFICE_SKILLS ở main process.
type OfficeSkill =
  | 'auto'
  | 'officecli-docx'
  | 'officecli-word-form'
  | 'officecli-academic-paper'
  | 'officecli-xlsx'
  | 'officecli-financial-model'
  | 'officecli-data-dashboard'
  | 'officecli-pptx'
  | 'officecli-pitch-deck'
  | 'morph-ppt'
  | 'morph-ppt-3d'

function officeKindFromPath(path: string): OfficeDocumentKind | null {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null
}

interface OfficeStatus {
  available: boolean
  version: string | null
  binaryPath: string | null
  workspaceDir: string | null
  error?: string
}

interface OfficeIssue {
  id: string
  type: string
  severity: string
  path: string
  message: string
  suggestion?: string
}

type SourceMode = 'documents' | 'notes' | 'knowledge'

interface KnowledgeHit {
  chunkId: string
  documentTitle: string
  content: string
}

const KIND_META: Record<
  OfficeDocumentKind,
  { label: string; icon: ReactElement; extension: string }
> = {
  docx: { label: 'Word', icon: <FileText className="w-4 h-4" />, extension: 'docx' },
  xlsx: { label: 'Excel', icon: <FileSpreadsheet className="w-4 h-4" />, extension: 'xlsx' },
  pptx: { label: 'PowerPoint', icon: <Presentation className="w-4 h-4" />, extension: 'pptx' }
}

const STAGE_LABEL: Record<string, string> = {
  creating_document: 'Đang tạo file...',
  editing_document: 'Đang mở tài liệu cần sửa...',
  generating_document: 'AI đang soạn nội dung...',
  retrying_document: 'Tài liệu trống — AI thử lại...',
  saving_document: 'Đang lưu tài liệu...',
  completed: 'Hoàn tất'
}

type OfficeMode = 'create' | 'edit'

interface OfficeTask {
  id: string
  label: string
  kind: OfficeDocumentKind
  skill: OfficeSkill
  instruction: string
}

// "Việc cần làm" — thay cho việc bắt người dùng hiểu khái niệm skill của officecli.
const OFFICE_TASKS: OfficeTask[] = [
  {
    id: 'report',
    label: 'Báo cáo (Word)',
    kind: 'docx',
    skill: 'officecli-docx',
    instruction:
      'Viết báo cáo hoàn chỉnh: tiêu đề, các mục heading rõ ràng, số liệu/bảng nếu có trong nguồn, phần kết luận. Giọng văn trang trọng, dùng đúng dữ kiện trong nguồn.'
  },
  {
    id: 'lesson',
    label: 'Giáo án (Word)',
    kind: 'docx',
    skill: 'officecli-word-form',
    instruction:
      'Soạn giáo án theo cấu trúc: mục tiêu, chuẩn bị, tiến trình bài dạy (hoạt động của giáo viên và học sinh), củng cố, dặn dò.'
  },
  {
    id: 'minutes',
    label: 'Biên bản họp (Word)',
    kind: 'docx',
    skill: 'officecli-docx',
    instruction:
      'Soạn biên bản: thời gian, địa điểm, thành phần tham dự, nội dung/diễn biến, kết luận và phân công. Bám sát nội dung nguồn.'
  },
  {
    id: 'academic',
    label: 'Đề cương học thuật (Word)',
    kind: 'docx',
    skill: 'officecli-academic-paper',
    instruction:
      'Soạn đề cương học thuật: đặt vấn đề, mục tiêu, phạm vi, nội dung chính theo mục, kết luận và tài liệu tham khảo nếu có.'
  },
  {
    id: 'slides',
    label: 'Slide trình chiếu (PowerPoint)',
    kind: 'pptx',
    skill: 'officecli-pptx',
    instruction:
      'Tạo bộ slide: slide mở đầu (tiêu đề + nội dung chính), mỗi mục một slide với 3-5 bullet ngắn, slide kết luận. Không nhồi chữ.'
  },
  {
    id: 'pitch',
    label: 'Pitch deck (PowerPoint)',
    kind: 'pptx',
    skill: 'officecli-pitch-deck',
    instruction:
      'Tạo pitch deck: vấn đề, giải pháp, giá trị nổi bật, số liệu chứng minh, kế hoạch, kết luận. Mỗi slide một thông điệp.'
  },
  {
    id: 'sheet',
    label: 'Bảng tính (Excel)',
    kind: 'xlsx',
    skill: 'officecli-xlsx',
    instruction:
      'Tạo bảng tính có dòng tiêu đề rõ ràng, dữ liệu lấy đúng từ nguồn, thêm sheet tổng hợp (tổng/đếm/trung bình) nếu phù hợp.'
  },
  {
    id: 'dashboard',
    label: 'Dashboard số liệu (Excel)',
    kind: 'xlsx',
    skill: 'officecli-data-dashboard',
    instruction:
      'Tạo bảng tổng hợp số liệu dạng dashboard: bảng dữ liệu gọn, các chỉ số tổng hợp, trình bày dễ đọc.'
  }
]

interface OfficeSkillOption {
  value: OfficeSkill
  label: string
  kinds: OfficeDocumentKind[]
}

// Danh sách skill officecli (phải khớp OFFICE_SKILLS ở main process).
const OFFICE_SKILL_OPTIONS: OfficeSkillOption[] = [
  { value: 'auto', label: 'Tự động (theo định dạng)', kinds: ['docx', 'xlsx', 'pptx'] },
  { value: 'officecli-docx', label: 'Word · văn bản chuyên nghiệp', kinds: ['docx'] },
  { value: 'officecli-word-form', label: 'Word · biểu mẫu', kinds: ['docx'] },
  { value: 'officecli-academic-paper', label: 'Word · bài báo học thuật', kinds: ['docx'] },
  { value: 'officecli-xlsx', label: 'Excel · bảng tính', kinds: ['xlsx'] },
  { value: 'officecli-financial-model', label: 'Excel · mô hình tài chính', kinds: ['xlsx'] },
  { value: 'officecli-data-dashboard', label: 'Excel · dashboard dữ liệu', kinds: ['xlsx'] },
  { value: 'officecli-pptx', label: 'PowerPoint · slide', kinds: ['pptx'] },
  { value: 'officecli-pitch-deck', label: 'PowerPoint · pitch deck', kinds: ['pptx'] },
  { value: 'morph-ppt', label: 'PowerPoint · morph + thư viện style', kinds: ['pptx'] },
  { value: 'morph-ppt-3d', label: 'PowerPoint · morph 3D', kinds: ['pptx'] }
]

export default function OfficePage(): ReactElement {
  const { notebookId } = useParams<{ notebookId: string }>()

  const [status, setStatus] = useState<OfficeStatus | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())
  const [docContents, setDocContents] = useState<Record<string, string>>({})
  const [sourceMode, setSourceMode] = useState<SourceMode>('documents')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[]>([])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<OfficeDocumentKind>('docx')
  const [skill, setSkill] = useState<OfficeSkill>('auto')
  const [mode, setMode] = useState<OfficeMode>('create')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [editingLocalPath, setEditingLocalPath] = useState<string | null>(null)
  const [extra, setExtra] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState<{ stage: string; progress: number } | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [issues, setIssues] = useState<OfficeIssue[] | null>(null)

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.office.status()
      setStatus(next)
    } catch (error) {
      console.error('[OfficePage] status failed:', error)
    }
  }, [])

  const loadNotes = useCallback(async (): Promise<void> => {
    if (!notebookId) return
    try {
      const loaded = await window.api.getNotes(notebookId)
      setNotes(loaded)
      setSelectedNoteIds(new Set(loaded.map((n) => n.id)))
    } catch (error) {
      console.error('[OfficePage] load notes failed:', error)
    }
  }, [notebookId])

  const loadDocuments = useCallback(async (): Promise<void> => {
    if (!notebookId) return
    try {
      const loaded = await window.api.knowledge.getDocuments(notebookId)
      setDocuments(loaded)
      setSelectedDocIds(
        new Set(loaded.filter((doc) => doc.status === 'indexed').map((doc) => doc.id))
      )
    } catch (error) {
      console.error('[OfficePage] load documents failed:', error)
    }
  }, [notebookId])

  useEffect(() => {
    void loadStatus()
    void loadNotes()
    void loadDocuments()
  }, [loadStatus, loadNotes, loadDocuments])

  useEffect(() => {
    if (!notebookId) return
    return window.api.knowledge.onDocumentsChanged((data) => {
      if (!data.notebookId || data.notebookId === notebookId) void loadDocuments()
    })
  }, [notebookId, loadDocuments])

  useEffect(() => {
    const missing = Array.from(selectedDocIds).filter((id) => !(id in docContents))
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        missing.map(async (id): Promise<[string, string]> => {
          try {
            const chunks = await window.api.knowledge.getDocumentChunks(id)
            const text = [...(chunks ?? [])]
              .sort((a, b) => a.chunkIndex - b.chunkIndex)
              .map((chunk) => chunk.content)
              .join('\n\n')
            return [id, text]
          } catch (error) {
            console.error('[OfficePage] load document content failed:', error)
            return [id, '']
          }
        })
      )
      if (cancelled) return
      setDocContents((prev) => {
        const next = { ...prev }
        for (const [id, text] of entries) next[id] = text
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [selectedDocIds, docContents])

  useEffect(() => {
    const cleanup = window.api.office.onGenerateProgress((data) => {
      setGenProgress({ stage: data.stage, progress: data.progress })
    })
    return cleanup
  }, [])

  // Đổi định dạng → nếu skill đang chọn không hợp lệ cho định dạng mới thì reset.
  useEffect(() => {
    const available = OFFICE_SKILL_OPTIONS.some(
      (option) => option.value === skill && option.kinds.includes(kind)
    )
    if (!available) setSkill('auto')
  }, [kind, skill])

  // Tài liệu Office đã nạp trong notebook (Word/Excel/PowerPoint) để chỉnh sửa.
  const officeDocs = useMemo(
    () => documents.filter((doc) => !!doc.localFilePath && officeKindFromPath(doc.localFilePath)),
    [documents]
  )

  const applyTask = (task: OfficeTask): void => {
    setMode('create')
    setActiveTaskId(task.id)
    setKind(task.kind)
    setSkill(task.skill)
    setExtra(task.instruction)
  }

  const markdown = useMemo(() => {
    const parts: string[] = []
    if (title.trim()) parts.push(`# ${title.trim()}`)

    if (sourceMode === 'notes') {
      for (const note of notes) {
        if (!selectedNoteIds.has(note.id)) continue
        const heading = note.title?.trim() || 'Ghi chú'
        parts.push(`\n## ${heading}\n`)
        parts.push(note.content.trim())
      }
    } else if (sourceMode === 'documents') {
      for (const doc of documents) {
        if (!selectedDocIds.has(doc.id)) continue
        const content = docContents[doc.id]?.trim()
        if (!content) continue
        parts.push(`\n## ${doc.title?.trim() || 'Tài liệu'}\n`)
        parts.push(content)
      }
    } else {
      const byDocument = new Map<string, string[]>()
      for (const hit of hits) {
        const list = byDocument.get(hit.documentTitle) ?? []
        list.push(hit.content.trim())
        byDocument.set(hit.documentTitle, list)
      }
      for (const [documentTitle, chunks] of byDocument) {
        parts.push(`\n## ${documentTitle}\n`)
        parts.push(chunks.join('\n\n'))
      }
    }

    if (extra.trim()) {
      parts.push('\n## Ghi chú bổ sung\n')
      parts.push(extra.trim())
    }

    return parts.join('\n').trim()
  }, [
    title,
    sourceMode,
    notes,
    selectedNoteIds,
    documents,
    selectedDocIds,
    docContents,
    hits,
    extra
  ])

  const handleSearch = async (): Promise<void> => {
    if (!notebookId || !query.trim()) return
    setIsBusy(true)
    setMessage(null)
    try {
      const result = await window.api.knowledge.search(notebookId, query.trim(), {
        topK: 12,
        includeContent: true
      })
      if (!result?.success) {
        setMessage({ kind: 'error', text: result?.error || 'Tìm kiếm thất bại' })
        setHits([])
        return
      }
      setHits(
        (result.results ?? []).map((r) => ({
          chunkId: r.chunkId,
          documentTitle: r.documentTitle,
          content: r.content
        }))
      )
      setSourceMode('knowledge')
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message })
    } finally {
      setIsBusy(false)
    }
  }

  const handleGenerate = async (): Promise<void> => {
    if (!notebookId) return
    if (!markdown.trim()) {
      setMessage({ kind: 'error', text: 'Chưa có nội dung nguồn để tạo tài liệu.' })
      return
    }

    setIsBusy(true)
    setMessage(null)
    setIssues(null)
    setOutputPath(null)
    setPreviewHtml(null)
    try {
      const defaultName = (title.trim() || 'tai-lieu').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      const target = await window.api.office.selectOutput(kind, defaultName)
      if (!target) {
        setIsBusy(false)
        return
      }

      const result = await window.api.office.exportDocument({
        kind,
        title: title.trim() || 'Tài liệu',
        markdown,
        outputPath: target,
        notebookId
      })

      if (!result?.success) {
        setMessage({ kind: 'error', text: result?.error || 'Tạo tài liệu thất bại' })
        return
      }

      setOutputPath(result.outputPath ?? target)
      setMessage({ kind: 'ok', text: 'Đã tạo tài liệu thành công.' })

      const check = await window.api.office.issues(result.outputPath ?? target)
      setIssues(check?.issues ?? [])
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message })
    } finally {
      setIsBusy(false)
    }
  }

  // Tạo/chỉnh sửa tài liệu bằng AI: để model tự soạn qua officecli (đọc skill →
  // add/set → validate → save). Sau khi xong, render HTML để xem trước (look→fix).
  const handleGenerateAI = async (): Promise<void> => {
    if (!notebookId) return

    const isEdit = mode === 'edit'
    const editKind = editingLocalPath ? officeKindFromPath(editingLocalPath) : null
    if (isEdit) {
      if (!editingLocalPath || !editKind) {
        setMessage({ kind: 'error', text: 'Chọn tài liệu Office cần chỉnh sửa.' })
        return
      }
      if (!extra.trim()) {
        setMessage({ kind: 'error', text: 'Nhập yêu cầu chỉnh sửa (ví dụ: gộp sheet, thêm cột…).' })
        return
      }
    } else if (!markdown.trim() && !extra.trim()) {
      setMessage({ kind: 'error', text: 'Cần chọn nguồn dữ liệu hoặc nhập chỉ dẫn trước.' })
      return
    }

    const effectiveKind = isEdit && editKind ? editKind : kind

    setIsGenerating(true)
    setGenProgress(null)
    setMessage(null)
    setIssues(null)
    setOutputPath(null)
    setPreviewHtml(null)
    try {
      const defaultName = (title.trim() || 'tai-lieu').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      const target = await window.api.office.selectOutput(effectiveKind, defaultName)
      if (!target) return

      const result = await window.api.office.generate({
        kind: effectiveKind,
        title: title.trim() || 'Tài liệu',
        skill: isEdit ? undefined : skill,
        instruction: extra.trim() || undefined,
        markdown,
        outputPath: target,
        notebookId,
        templatePath: isEdit && editingLocalPath ? editingLocalPath : undefined
      })

      if (!result?.success) {
        const hint =
          result?.status === 'no_provider'
            ? ' Hãy cấu hình model chat trong Cài đặt, hoặc dùng nút "Tạo nhanh".'
            : ''
        setMessage({ kind: 'error', text: (result?.error || 'Tạo tài liệu thất bại') + hint })
        return
      }

      const created = result.outputPath ?? target
      setOutputPath(created)
      setMessage({
        kind: 'ok',
        text: result.usedFallback
          ? 'AI chưa ghi được nội dung — đã dựng tài liệu từ markdown.'
          : `${isEdit ? 'Đã lưu bản chỉnh sửa' : 'Đã tạo tài liệu bằng AI'} thành công.${
              result.attempts && result.attempts > 1 ? ' (phải thử lại 1 lượt)' : ''
            }`
      })

      const check = await window.api.office.issues(created)
      setIssues(check?.issues ?? [])

      const preview = await window.api.office.renderPreview(created)
      if (preview?.success && preview.html) setPreviewHtml(preview.html)
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message })
    } finally {
      setIsGenerating(false)
      setGenProgress(null)
    }
  }

  const toggleNote = (id: string): void => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleDocument = (id: string): void => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const engineReady = status?.available === true

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <PanelHeader
        brand
        draggable
        left={<span className="text-sm font-medium">Office Assistant</span>}
        right={
          <Button
            onClick={() => void loadStatus()}
            variant="ghost"
            size="icon"
            className="w-8 h-8 text-white/80 hover:bg-white/10 hover:text-white"
            title="Kiểm tra lại engine"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        }
      />

      <div className="flex-1 min-h-0 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 h-full">
          {/* Cột trái: nguồn dữ liệu */}
          <Card className="flex flex-col rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium">Nguồn dữ liệu</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={sourceMode === 'documents' ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setSourceMode('documents')}
                >
                  Tài liệu
                </Button>
                <Button
                  size="sm"
                  variant={sourceMode === 'notes' ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setSourceMode('notes')}
                >
                  Ghi chú
                </Button>
                <Button
                  size="sm"
                  variant={sourceMode === 'knowledge' ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setSourceMode('knowledge')}
                >
                  Tri thức
                </Button>
              </div>
            </div>

            {sourceMode === 'knowledge' && (
              <div className="px-4 py-3 border-b border-border flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSearch()
                  }}
                  placeholder="Tìm trong tài liệu đã nạp..."
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={isBusy || !query.trim()}
                  onClick={() => void handleSearch()}
                >
                  <Search className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {sourceMode === 'documents' ? (
                  documents.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 text-center">
                      Notebook chưa có tài liệu nào được nạp.
                    </p>
                  ) : (
                    documents.map((doc) => (
                      <label
                        key={doc.id}
                        className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(doc.id)}
                          onChange={() => toggleDocument(doc.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {doc.title || 'Tài liệu'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {doc.chunkCount ?? 0} đoạn · {doc.status}
                          </div>
                        </div>
                      </label>
                    ))
                  )
                ) : sourceMode === 'notes' ? (
                  notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4 text-center">
                      Notebook chưa có ghi chú nào.
                    </p>
                  ) : (
                    notes.map((note) => (
                      <label
                        key={note.id}
                        className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedNoteIds.has(note.id)}
                          onChange={() => toggleNote(note.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {note.title || 'Ghi chú'}
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-2">
                            {note.content.slice(0, 120)}
                          </div>
                        </div>
                      </label>
                    ))
                  )
                ) : hits.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">
                    Nhập từ khoá và bấm tìm để lấy các đoạn trích từ tài liệu đã chunking.
                  </p>
                ) : (
                  hits.map((hit) => (
                    <div key={hit.chunkId} className="p-2 rounded-lg border border-border">
                      <div className="text-xs font-medium truncate">{hit.documentTitle}</div>
                      <div className="text-xs text-muted-foreground line-clamp-3">
                        {hit.content.slice(0, 200)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </Card>

          {/* Cột phải: cấu hình + kết quả */}
          <Card className="flex flex-col rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-sm font-medium">
              Tạo tài liệu để nộp / chia sẻ
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {!engineReady && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Office engine chưa sẵn sàng
                      {status?.error ? `: ${status.error}` : '.'} Cần binary officecli cho nền tảng
                      này trong resources/officecli.
                    </span>
                  </div>
                )}

                {engineReady && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                    <span>Engine v{status?.version} sẵn sàng</span>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Chọn nguồn ở cột trái → chọn việc cần làm → bấm tạo. Kết quả là file Word / Excel
                  / PowerPoint thật để mở, nộp hoặc chia sẻ.
                </p>

                {/* Chế độ: tạo mới hay chỉnh sửa tài liệu Office đã nạp */}
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={mode === 'create' ? 'default' : 'outline'}
                    className="flex-1 h-8 text-xs"
                    onClick={() => setMode('create')}
                  >
                    Tạo mới
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === 'edit' ? 'default' : 'outline'}
                    className="flex-1 h-8 text-xs"
                    onClick={() => setMode('edit')}
                  >
                    Sửa tài liệu Office có sẵn
                  </Button>
                </div>

                {mode === 'create' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Bạn muốn làm gì?</label>
                      <div className="flex flex-wrap gap-1.5">
                        {OFFICE_TASKS.map((task) => (
                          <Button
                            key={task.id}
                            size="sm"
                            variant={activeTaskId === task.id ? 'secondary' : 'outline'}
                            className="h-7 text-xs"
                            onClick={() => applyTask(task)}
                          >
                            {task.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">Định dạng</label>
                      <div className="flex gap-2">
                        {(Object.keys(KIND_META) as OfficeDocumentKind[]).map((key) => (
                          <Button
                            key={key}
                            size="sm"
                            variant={kind === key ? 'default' : 'outline'}
                            className="gap-1.5"
                            onClick={() => {
                              setKind(key)
                              setActiveTaskId(null)
                            }}
                          >
                            {KIND_META[key].icon}
                            {KIND_META[key].label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Kiểu tài liệu (kỹ năng officecli)
                      </label>
                      <Select
                        value={skill}
                        onValueChange={(value) => setSkill(value as OfficeSkill)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OFFICE_SKILL_OPTIONS.filter((option) => option.kinds.includes(kind)).map(
                            (option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {mode === 'edit' && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Chọn tài liệu Office cần chỉnh sửa
                    </label>
                    {officeDocs.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-3 rounded-lg border border-border">
                        Chưa có tài liệu Word/Excel/PowerPoint nào trong kho tri thức. Hãy nạp file
                        trước, hoặc tạo mới rồi tài liệu đó sẽ xuất hiện ở đây.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {officeDocs.map((doc) => {
                          const docPath = doc.localFilePath as string
                          const selected = editingLocalPath === docPath
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => {
                                setEditingLocalPath(docPath)
                                const k = officeKindFromPath(docPath)
                                if (k) setKind(k)
                              }}
                              className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs ${
                                selected
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border hover:bg-muted'
                              }`}
                            >
                              <span className="font-medium truncate">
                                {doc.title || 'Tài liệu'}
                              </span>
                              <span className="ml-auto shrink-0 text-muted-foreground">
                                {officeKindFromPath(docPath)?.toUpperCase()}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Tiêu đề tài liệu</label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ví dụ: Báo cáo tổng hợp quý"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">
                    {mode === 'edit'
                      ? 'Yêu cầu chỉnh sửa (bắt buộc)'
                      : 'Chỉ dẫn cho AI / Ghi chú bổ sung (tuỳ chọn)'}
                  </label>
                  <Textarea
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    placeholder={
                      mode === 'edit'
                        ? 'Ví dụ: gộp hai sheet thành một, thêm cột Thành tiền, chuẩn hoá ngày tháng...'
                        : 'Ví dụ: báo cáo 8 slide, giọng trang trọng, nhấn mạnh số liệu quý 3...'
                    }
                    rows={3}
                  />
                </div>

                {mode === 'create' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground">
                        Xem trước nội dung ({markdown.length} ký tự)
                      </label>
                    </div>
                    <pre className="max-h-40 overflow-auto rounded-lg border border-border p-3 text-xs whitespace-pre-wrap">
                      {markdown.slice(0, 2000) || 'Chưa có nội dung.'}
                    </pre>
                  </div>
                )}

                <Button
                  className="w-full gap-2"
                  disabled={
                    isGenerating ||
                    isBusy ||
                    !engineReady ||
                    (mode === 'edit'
                      ? !editingLocalPath || !extra.trim()
                      : !markdown.trim() && !extra.trim())
                  }
                  onClick={() => void handleGenerateAI()}
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {mode === 'edit'
                    ? 'Lưu bản chỉnh sửa'
                    : `Tạo tài liệu bằng AI ${KIND_META[kind].label}`}
                </Button>

                {isGenerating && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{STAGE_LABEL[genProgress?.stage ?? ''] ?? 'AI đang xử lý...'}</span>
                      <span>{genProgress?.progress ?? 0}%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${genProgress?.progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {mode === 'create' && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    disabled={isBusy || isGenerating || !engineReady || !markdown.trim()}
                    onClick={() => void handleGenerate()}
                  >
                    {isBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    Tạo nhanh từ markdown
                  </Button>
                )}

                {message && (
                  <div
                    className={`text-xs p-3 rounded-lg ${
                      message.kind === 'ok'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-destructive/10 text-destructive'
                    }`}
                  >
                    {message.text}
                  </div>
                )}

                {outputPath && (
                  <div className="space-y-2">
                    <div className="text-xs break-all text-muted-foreground">{outputPath}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => void window.api.office.openFile(outputPath)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Mở tài liệu
                    </Button>
                  </div>
                )}

                {previewHtml && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium">Xem trước ({KIND_META[kind].label})</div>
                    <iframe
                      title="office-preview"
                      sandbox=""
                      srcDoc={previewHtml}
                      className="w-full h-72 rounded-lg border border-border bg-white"
                    />
                  </div>
                )}

                {issues && issues.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium">Kiểm tra chất lượng ({issues.length})</div>
                    <div className="space-y-1">
                      {issues.slice(0, 8).map((issue) => (
                        <div key={issue.id} className="text-xs text-muted-foreground">
                          <span className="text-foreground">{issue.path}</span> — {issue.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>
      </div>
    </div>
  )
}
