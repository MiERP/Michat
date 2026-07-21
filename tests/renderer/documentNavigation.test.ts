import { describe, expect, it } from 'vitest'
import { getDocumentNavigationAction } from '../../src/renderer/src/components/notebook/source/documentNavigation'

const documentIds = ['van-ban-1', 'van-ban-2', 'van-ban-3']

describe('getDocumentNavigationAction', () => {
  it('chọn tài liệu đầu hoặc cuối khi chưa có lựa chọn', () => {
    expect(getDocumentNavigationAction(documentIds, null, 'ArrowDown')).toEqual({
      selectedDocumentId: 'van-ban-1'
    })
    expect(getDocumentNavigationAction(documentIds, null, 'ArrowUp')).toEqual({
      selectedDocumentId: 'van-ban-3'
    })
  })

  it('di chuyển trong giới hạn danh sách', () => {
    expect(getDocumentNavigationAction(documentIds, 'van-ban-2', 'ArrowDown')).toEqual({
      selectedDocumentId: 'van-ban-3'
    })
    expect(getDocumentNavigationAction(documentIds, 'van-ban-1', 'ArrowUp')).toEqual({
      selectedDocumentId: 'van-ban-1'
    })
  })

  it('đi đến đầu hoặc cuối danh sách', () => {
    expect(getDocumentNavigationAction(documentIds, 'van-ban-2', 'Home')).toEqual({
      selectedDocumentId: 'van-ban-1'
    })
    expect(getDocumentNavigationAction(documentIds, 'van-ban-2', 'End')).toEqual({
      selectedDocumentId: 'van-ban-3'
    })
  })

  it('mở tài liệu đang chọn bằng Enter', () => {
    expect(getDocumentNavigationAction(documentIds, 'van-ban-2', 'Enter')).toEqual({ open: true })
    expect(getDocumentNavigationAction(documentIds, null, 'Enter')).toBeNull()
  })
})
