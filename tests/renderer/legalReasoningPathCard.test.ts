import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LegalReasoningResult } from '../../src/shared/types/legalReasoning'
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

describe('LegalReasoningPathCard', () => {
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
})
