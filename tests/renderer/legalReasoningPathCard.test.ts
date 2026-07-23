// @vitest-environment jsdom

import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegalReasoningResult } from '../../src/shared/types/legalReasoning'
import { useKnowledgeStore } from '../../src/renderer/src/store/knowledgeStore'
import {
  LegalReasoningPathCard,
  getGraphStatusLabel,
  getRelationLabel
} from '../../src/renderer/src/components/notebook/chat/LegalReasoningPathCard'

const result: LegalReasoningResult = {
  intent: 'sanction',
  graphStatus: 'ready',
  limitations: [],
  paths: [
    {
      score: 0.84,
      minimumConfidence: 0.82,
      steps: [
        {
          relationId: 'relation-1',
          relationType: 'requires',
          sourceNodeId: 'subject-1',
          sourceLabel: 'Doanh nghi\u1ec7p',
          targetNodeId: 'action-1',
          targetLabel: 'N\u1ed9p h\u1ed3 s\u01a1',
          confidence: 0.91,
          citationIds: [1]
        },
        {
          relationId: 'relation-2',
          relationType: 'condition_for',
          sourceNodeId: 'action-1',
          sourceLabel: 'N\u1ed9p h\u1ed3 s\u01a1 ch\u1eadm',
          targetNodeId: 'violation-1',
          targetLabel: 'Vi ph\u1ea1m th\u1eddi h\u1ea1n',
          confidence: 0.87,
          citationIds: [2]
        },
        {
          relationId: 'relation-3',
          relationType: 'sanction_for',
          sourceNodeId: 'sanction-1',
          sourceLabel: 'Ph\u1ea1t ti\u1ec1n',
          targetNodeId: 'violation-1',
          targetLabel: 'Vi ph\u1ea1m th\u1eddi h\u1ea1n',
          confidence: 0.82,
          citationIds: [3]
        }
      ]
    }
  ]
}

const pendingResult: LegalReasoningResult = {
  ...result,
  graphStatus: 'pending',
  paths: [],
  evidence: [
    {
      citationId: 1,
      notebookId: 'notebook-1',
      documentId: 'document-1',
      documentTitle: 'Luật thử nghiệm',
      chunkId: 'chunk-1',
      chunkIndex: 0,
      content: 'Điều 1. Nghĩa vụ xử lý dữ liệu.',
      score: 0.9
    }
  ]
}

describe('LegalReasoningPathCard', () => {
  let container: HTMLDivElement
  let root: Root | undefined
  let retryLegalGraphMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    retryLegalGraphMock = vi.fn().mockResolvedValue({ success: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        knowledge: {
          getLegalGraphStatus: vi.fn().mockResolvedValue({ success: false }),
          retryLegalGraph: retryLegalGraphMock
        }
      }
    })
    useKnowledgeStore.setState({ legalGraphStatuses: {} })
  })

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container.remove()
    root = undefined
  })

  async function renderCard(cardResult: LegalReasoningResult): Promise<void> {
    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(LegalReasoningPathCard, { result: cardResult }))
    })
  }

  it('renders collapsed header without exposing steps initially', () => {
    const html = renderToStaticMarkup(React.createElement(LegalReasoningPathCard, { result }))

    expect(html).toContain('\u0110\u01b0\u1eddng suy lu\u1eadn ph\u00e1p l\u00fd')
    expect(html).toContain('3 b\u01b0\u1edbc')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('sanction_for')
    expect(html).not.toContain('ch\u1ebf t\u00e0i cho')
  })

  it('formats graph states and Vietnamese predicates', () => {
    expect(getGraphStatusLabel('pending')).toBe(
      '\u0110ang ch\u1edd ph\u00e2n t\u00edch \u0111\u1ed3 th\u1ecb'
    )
    expect(getRelationLabel('sanction_for')).toBe('ch\u1ebf t\u00e0i cho')
  })

  it('overrides a stale pending snapshot with live failed status', async () => {
    useKnowledgeStore.setState({
      legalGraphStatuses: {
        'document-1': {
          status: 'failed',
          attempts: 5,
          sourceUnitCount: 218,
          processedUnitCount: 0,
          nodeCount: 0,
          relationCount: 0,
          lastError: 'Ollama model request failed: connection refused'
        }
      }
    })

    await renderCard(pendingResult)

    expect(container.textContent).toContain('Phân tích đồ thị thất bại')
    expect(container.textContent).toContain(
      'Không thể hoàn tất phân tích quan hệ. Câu trả lời từ tài liệu trực tiếp vẫn dùng được.'
    )
    expect(container.textContent).not.toContain('Ollama model request failed: connection refused')
    expect(container.textContent).not.toContain('Đang chờ phân tích đồ thị')
  })

  it('renders live processing progress', async () => {
    useKnowledgeStore.setState({
      legalGraphStatuses: {
        'document-1': {
          status: 'processing',
          attempts: 1,
          sourceUnitCount: 218,
          processedUnitCount: 54,
          nodeCount: 0,
          relationCount: 0
        }
      }
    })

    await renderCard(pendingResult)

    expect(container.textContent).toContain('54/218')
    expect(container.textContent).toContain('25%')
  })

  it('retries the failed evidence document', async () => {
    useKnowledgeStore.setState({
      legalGraphStatuses: {
        'document-1': {
          status: 'failed',
          attempts: 5,
          sourceUnitCount: 218,
          processedUnitCount: 0,
          nodeCount: 0,
          relationCount: 0,
          lastError: 'provider unavailable'
        }
      }
    })
    await renderCard(pendingResult)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-legal-graph-retry]')?.click()
    })

    expect(retryLegalGraphMock).toHaveBeenCalledWith('document-1')
  })
})
