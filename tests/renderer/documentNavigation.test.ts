import { describe, expect, it } from 'vitest'
import { getDocumentNavigationAction } from '../../src/renderer/src/components/notebook/source/documentNavigation'

const documentIds = ['document-1', 'document-2', 'document-3']

describe('getDocumentNavigationAction', () => {
  it('selects first or last document without an existing selection', () => {
    expect(getDocumentNavigationAction(documentIds, null, 'ArrowDown')).toEqual({
      selectedDocumentId: 'document-1'
    })
    expect(getDocumentNavigationAction(documentIds, null, 'ArrowUp')).toEqual({
      selectedDocumentId: 'document-3'
    })
  })

  it('moves within list boundaries', () => {
    expect(getDocumentNavigationAction(documentIds, 'document-2', 'ArrowDown')).toEqual({
      selectedDocumentId: 'document-3'
    })
    expect(getDocumentNavigationAction(documentIds, 'document-1', 'ArrowUp')).toEqual({
      selectedDocumentId: 'document-1'
    })
  })

  it('opens selected document with Enter', () => {
    expect(getDocumentNavigationAction(documentIds, 'document-2', 'Enter')).toEqual({ open: true })
    expect(getDocumentNavigationAction(documentIds, null, 'Enter')).toBeNull()
  })
})
