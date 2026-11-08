import type { ChatScope } from '../../shared/types/chat'
import type { SearchMetadataFilter } from '../../shared/types/knowledge'

/**
 * Chuyển phạm vi chat (tài liệu → mục → trang) thành filter cho KnowledgeService.
 * Metadata pháp lý được áp dụng tự động ở tầng retrieval, không đưa vào scope
 * người dùng chọn tay.
 */
export function buildScopeFilter(scope?: ChatScope): SearchMetadataFilter | undefined {
  if (!scope) return undefined

  const documentIds = scope.documentIds?.filter((id) => typeof id === 'string' && id.trim())
  const sectionPath = scope.sectionPath?.filter((part) => typeof part === 'string' && part.trim())
  const pageRange =
    scope.pageRange && scope.pageRange.from <= scope.pageRange.to ? scope.pageRange : undefined

  if (!documentIds?.length && !sectionPath?.length && !pageRange) return undefined

  return {
    documentIds: documentIds?.length ? documentIds : undefined,
    sectionPath: sectionPath?.length ? sectionPath : undefined,
    pageRange
  }
}
