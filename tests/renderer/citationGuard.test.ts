import { describe, expect, it } from 'vitest'
import { ensureInlineCitationPlacement, linkifyCitationMarkers } from '../../src/renderer/src/components/notebook/chat/MessageItem'

const citations = [{ index: 1, chunkId: 'c1', documentId: 'd1', documentTitle: 'Doc', content: 'evidence' }] as any

describe('citation guard', () => {
  it('strips invalid citation markers and keeps valid citation links', () => {
    const guarded = ensureInlineCitationPlacement('Valid [1], invalid [9], code `[9]`.', citations)
    const rendered = linkifyCitationMarkers(guarded, citations)

    expect(rendered).toContain('[1](citation:1)')
    expect(rendered).not.toContain('[9]')
  })
})
