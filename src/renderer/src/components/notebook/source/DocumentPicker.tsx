/**
 * DocumentPicker
 * Chọn tài liệu để tạo quiz: "Tất cả tài liệu" hoặc chọn từng tài liệu.
 * selectedIds rỗng = tất cả tài liệu.
 */

import { ReactElement } from 'react'
import { CheckSquare, Square } from 'lucide-react'
import type { KnowledgeDocument } from '../../../../../shared/types/knowledge'

interface DocumentPickerProps {
  documents: KnowledgeDocument[]
  selectedIds: string[]
  onChange: (selectedIds: string[]) => void
}

export default function DocumentPicker({
  documents,
  selectedIds,
  onChange
}: DocumentPickerProps): ReactElement {
  const indexedDocs = documents.filter((doc) => doc.status === 'indexed')
  const useAll = selectedIds.length === 0
  const selectedSet = new Set(selectedIds)

  const handleToggleAll = () => {
    onChange(useAll ? indexedDocs.map((doc) => doc.id) : [])
  }

  const handleToggleDoc = (documentId: string) => {
    const next = new Set(selectedIds)
    if (next.has(documentId)) next.delete(documentId)
    else next.add(documentId)
    onChange(Array.from(next))
  }

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <div className="max-h-40 overflow-y-auto p-1">
        <button
          type="button"
          onClick={handleToggleAll}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
        >
          {useAll ? (
            <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className={useAll ? 'font-medium' : ''}>Tất cả tài liệu</span>
          <span className="ml-auto text-xs text-muted-foreground">{indexedDocs.length}</span>
        </button>

        {indexedDocs.map((doc) => {
          const checked = selectedSet.has(doc.id)
          return (
            <button
              key={doc.id}
              type="button"
              onClick={() => handleToggleDoc(doc.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              {checked ? (
                <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 truncate">{doc.title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {doc.chunkCount}
              </span>
            </button>
          )
        })}

        {indexedDocs.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Chưa có tài liệu nào được index trong notebook này.
          </p>
        )}
      </div>
      <div className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
        {useAll
          ? `Sẽ dùng ${indexedDocs.length} tài liệu đã index.`
          : `Đã chọn ${selectedSet.size}/${indexedDocs.length} tài liệu.`}
      </div>
    </div>
  )
}
