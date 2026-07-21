export interface DocumentNavigationAction {
  selectedDocumentId?: string
  open?: boolean
}

export function getDocumentNavigationAction(
  documentIds: string[],
  selectedDocumentId: string | null,
  key: string
): DocumentNavigationAction | null {
  if (documentIds.length === 0) return null

  const selectedIndex = selectedDocumentId ? documentIds.indexOf(selectedDocumentId) : -1

  if (key === 'Enter') {
    return selectedIndex >= 0 ? { open: true } : null
  }

  if (key === 'Home') return { selectedDocumentId: documentIds[0] }
  if (key === 'End') return { selectedDocumentId: documentIds[documentIds.length - 1] }

  if (key === 'ArrowDown') {
    return {
      selectedDocumentId: documentIds[Math.min(selectedIndex + 1, documentIds.length - 1)]
    }
  }

  if (key === 'ArrowUp') {
    return {
      selectedDocumentId:
        documentIds[selectedIndex < 0 ? documentIds.length - 1 : Math.max(selectedIndex - 1, 0)]
    }
  }

  return null
}
