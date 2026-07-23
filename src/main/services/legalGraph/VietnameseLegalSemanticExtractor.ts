import { createHash } from 'crypto'
import type { Chunk } from '../../db/schema'
import type {
  LegalGraphCandidateNode,
  LegalGraphCandidateRelation
} from './LegalGraphRepository'

const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
const compact = (value: string): string =>
  value
    .replace(/^Điều\s+\d+[a-zđ]?\.?\s*/iu, '')
    .replace(/\s+/gu, ' ')
    .replace(/[.;:]$/u, '')
    .trim()

export function extractVietnameseLegalSemantics(
  chunk: Chunk,
  sourceLocalId: string,
  canonicalWorkKey: string
): { nodes: LegalGraphCandidateNode[]; relations: LegalGraphCandidateRelation[] } {
  const nodes: LegalGraphCandidateNode[] = []
  const relations: LegalGraphCandidateRelation[] = []
  const baseOffset = chunk.startOffset ?? 0

  for (const match of chunk.content.matchAll(/(?:^|[.!?]\s+)([^.!?\n]{2,100}?)\s+(phải|có trách nhiệm)\s+([^.!?\n]{2,160})/giu)) {
    const subject = compact(match[1])
    const action = compact(match[3])
    if (!subject || !action) continue
    const subjectId = `semantic:subject:${hash(`${canonicalWorkKey}:${subject.toLocaleLowerCase('vi-VN')}`)}`
    const actionId = `semantic:action:${hash(`${canonicalWorkKey}:${action.toLocaleLowerCase('vi-VN')}`)}`
    nodes.push(
      { localId: subjectId, nodeType: 'subject', canonicalKey: subjectId, label: subject, aliases: [], chunkId: chunk.id },
      { localId: actionId, nodeType: 'action', canonicalKey: actionId, label: action, aliases: [], chunkId: chunk.id }
    )
    const evidenceText = match[0].trim()
    const relativeStart = (match.index ?? 0) + match[0].indexOf(evidenceText)
    relations.push({
      sourceLocalId: subjectId,
      targetLocalId: actionId,
      relationType: 'requires',
      evidenceChunkId: chunk.id,
      evidenceText,
      evidenceStartOffset: baseOffset + relativeStart,
      evidenceEndOffset: baseOffset + relativeStart + evidenceText.length,
      confidence: 0.9,
      qualifiers: { extractor: 'deterministic-vietnamese' }
    })
  }

  for (const match of chunk.content.matchAll(/(?:^|[.!?]\s+)([^.!?\n]{2,120}?)\s+(bị\s+(?:phạt tiền|phạt cảnh cáo|đình chỉ|tước quyền|buộc)[^.!?\n]{0,160})/giu)) {
    const sanction = compact(match[2])
    if (!sanction) continue
    const sanctionId = `semantic:sanction:${hash(`${canonicalWorkKey}:${sanction.toLocaleLowerCase('vi-VN')}`)}`
    nodes.push({ localId: sanctionId, nodeType: 'sanction', canonicalKey: sanctionId, label: sanction, aliases: [], chunkId: chunk.id })
    const evidenceText = match[0].trim()
    const relativeStart = (match.index ?? 0) + match[0].indexOf(evidenceText)
    relations.push({
      sourceLocalId: sanctionId,
      targetLocalId: sourceLocalId,
      relationType: 'sanction_for',
      evidenceChunkId: chunk.id,
      evidenceText,
      evidenceStartOffset: baseOffset + relativeStart,
      evidenceEndOffset: baseOffset + relativeStart + evidenceText.length,
      confidence: 0.85,
      qualifiers: { extractor: 'deterministic-vietnamese' }
    })
  }

  return { nodes, relations }
}
