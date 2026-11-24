import { KeyboardEvent, ReactElement, useRef, useEffect, useState } from 'react'
import { FileText, Globe, FileUp, StickyNote, Trash2, Loader2, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeDocument } from '../../../../../shared/types/knowledge'
import { Button } from '../../ui/button'
import ConfirmDialog from '../../common/ConfirmDialog'
import { getDocumentNavigationAction } from './documentNavigation'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent
} from '../../ui/empty'

interface DocumentListProps {
  documents: KnowledgeDocument[]
  hasEmbeddingModel: boolean
  selectedDocumentId: string | null
  onDeleteDocument: (documentId: string) => void
  onSelectDocument: (document: KnowledgeDocument) => void
  onOpenDocument: (document: KnowledgeDocument) => void
  onOpenSettings: () => void
}

export default function DocumentList({
  documents,
  hasEmbeddingModel,
  selectedDocumentId,
  onDeleteDocument,
  onSelectDocument,
  onOpenDocument,
  onOpenSettings
}: DocumentListProps): ReactElement {
  const { t } = useTranslation('ui')
  const itemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    if (!selectedDocumentId) return
    const item = itemRefs.current.get(selectedDocumentId)
    item?.focus()
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedDocumentId])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (
      target.closest('button, input, textarea, select, [contenteditable="true"], [role="dialog"]')
    ) {
      return
    }

    const action = getDocumentNavigationAction(
      documents.map((document) => document.id),
      selectedDocumentId,
      event.key
    )
    if (!action) return

    event.preventDefault()
    if (action.open && selectedDocumentId) {
      const selectedDocument = documents.find((document) => document.id === selectedDocumentId)
      if (selectedDocument) onOpenDocument(selectedDocument)
      return
    }

    if (action.selectedDocumentId) {
      const nextDocument = documents.find((document) => document.id === action.selectedDocumentId)
      if (nextDocument) onSelectDocument(nextDocument)
    }
  }

  // Prompt when no embedding model is configured (highest priority)
  if (!hasEmbeddingModel && documents.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Database className="w-12 h-12 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{t('noEmbeddingModelConfigured')}</EmptyTitle>
          <EmptyDescription>{t('noEmbeddingModelConfiguredDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onOpenSettings}>{t('goToSettings')}</Button>
        </EmptyContent>
      </Empty>
    )
  }

  // Empty state when there are no documents (refactored with the Empty component)
  if (documents.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText className="w-12 h-12 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{t('noDocuments')}</EmptyTitle>
          <EmptyDescription>{t('noDocumentsDesc')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div
      className="p-2 space-y-1"
      role="listbox"
      aria-label="Danh sách tài liệu"
      onKeyDown={handleKeyDown}
    >
      {documents.map((doc, index) => (
        <DocumentItem
          key={doc.id}
          document={doc}
          selected={doc.id === selectedDocumentId}
          tabIndex={doc.id === selectedDocumentId || (!selectedDocumentId && index === 0) ? 0 : -1}
          itemRef={(element) => {
            if (element) itemRefs.current.set(doc.id, element)
            else itemRefs.current.delete(doc.id)
          }}
          onDelete={onDeleteDocument}
          onSelect={onSelectDocument}
          onOpen={onOpenDocument}
        />
      ))}
    </div>
  )
}

// Document item component
interface DocumentItemProps {
  document: KnowledgeDocument
  selected: boolean
  tabIndex: number
  itemRef: (element: HTMLDivElement | null) => void
  onDelete: (id: string) => void
  onSelect: (document: KnowledgeDocument) => void
  onOpen: (document: KnowledgeDocument) => void
}

function DocumentItem({
  document,
  selected,
  tabIndex,
  itemRef,
  onDelete,
  onSelect,
  onOpen
}: DocumentItemProps): ReactElement {
  const { t } = useTranslation('ui')
  const hasShownErrorRef = useRef(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const getTypeIcon = () => {
    const iconClass = 'w-4 h-4 mt-0.5 text-muted-foreground'
    switch (document.type) {
      case 'file':
        return <FileUp className={iconClass} />
      case 'url':
        return <Globe className={iconClass} />
      case 'note':
        return <StickyNote className={iconClass} />
      default:
        return <FileText className={iconClass} />
    }
  }

  // Show failure notice (only once)
  useEffect(() => {
    if (document.status === 'failed' && !hasShownErrorRef.current) {
      hasShownErrorRef.current = true
      alert(t('embeddingFailed', { title: document.title }))
    }
  }, [document.status, document.title, t])

  const handleConfirmDelete = () => {
    onDelete(document.id)
  }

  return (
    <div
      ref={itemRef}
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={() => onSelect(document)}
      onDoubleClick={() => onOpen(document)}
      onFocus={() => onSelect(document)}
      className={`group grid grid-cols-[auto_1fr_auto] gap-2 items-start p-3 rounded-lg transition-colors cursor-pointer select-none outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? 'brand-selection border ring-1 ring-primary/40' : ''
      }`}
    >
      {/* Icon column - fixed width */}
      {getTypeIcon()}

      {/* Content column - can shrink */}
      <div className="min-w-0 flex flex-col gap-1">
        <h3 className="text-sm font-medium truncate">{document.title}</h3>
        <p className="text-xs text-muted-foreground">{document.chunkCount} phân đoạn</p>
        {document.status === 'processing' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('indexing')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          onClick={(e) => {
            e.stopPropagation()
            setIsDeleteDialogOpen(true)
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 w-8 h-8 mt-0.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          title={t('deleteDocument')}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Delete document confirmation dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t('deleteDocument')}
        message={t('confirmDeleteDocument')}
      />
    </div>
  )
}
