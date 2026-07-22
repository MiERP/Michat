export const LEGAL_DOCUMENT_STATUSES = [
  'effective',
  'partially_repealed',
  'replaced',
  'repealed',
  'expired',
  'draft',
  'unknown'
] as const

export type LegalDocumentStatus = (typeof LEGAL_DOCUMENT_STATUSES)[number]

export interface LegalDocumentMetadata {
  documentNumber?: string
  documentType?: string
  issuer?: string
  documentTitle?: string
  legalBases?: string
  jurisdiction?: string
  issuedAt?: string
  effectiveFrom?: string
  effectiveTo?: string
  status: LegalDocumentStatus
  scope?: string
  sourceAuthority?: string
  officialSourceUrl?: string
  sourceHash?: string
  verifiedAt?: string
  verifiedBy?: string
  amendsDocumentIds: string[]
  replacesDocumentIds: string[]
  repealedByDocumentIds: string[]
}

export interface LegalComparisonEvidence {
  citationId: number
  documentId: string
  documentTitle: string
  chunkId: string
  chunkIndex: number
  score: number
  content: string
  legalContext?: {
    chapterNumber?: string
    chapterTitle?: string
    sectionNumber?: string
    sectionTitle?: string
    articleNumber?: string
    articleTitle?: string
    clauseNumber?: string
    pointNumber?: string
  }
  metadata: LegalDocumentMetadata
}

export type LegalComparisonRelation =
  | 'equivalent'
  | 'supplement'
  | 'specify'
  | 'different_scope'
  | 'temporal_change'
  | 'potential_conflict'
  | 'conflict'
  | 'insufficient_evidence'

export interface LegalComparisonRow {
  topic: string
  leftDocumentId: string
  rightDocumentId: string
  relation: LegalComparisonRelation
  reason: string
  citationIds: number[]
}

export interface LegalComparisonDocumentEvidence {
  documentId: string
  documentTitle: string
  metadata: LegalDocumentMetadata
  evidenceIds: number[]
}

export interface LegalComparisonResolution {
  status: 'resolved' | 'needs_metadata' | 'needs_user_facts' | 'insufficient_evidence'
  reason: string
  preferredDocumentId?: string
  citationIds: number[]
  requiredMetadata?: string[]
}

export interface LegalComparisonResult {
  mode: 'compare'
  evidence: LegalComparisonEvidence[]
  evidenceByDocument: LegalComparisonDocumentEvidence[]
  rows: LegalComparisonRow[]
  resolution: LegalComparisonResolution
  limitations: string[]
}

type LegalDocumentMetadataInput = Partial<LegalDocumentMetadata>

const comparisonPattern = /(so\s*sánh|đối\s*chiếu|khác\s*nhau|mâu\s*thuẫn|xung\s*đột|văn\s*bản\s*nào|quy\s*định\s*nào)/iu
const applicabilityPattern = /(áp\s*dụng|ưu\s*tiên|hiệu\s*lực|thay\s*thế|bãi\s*bỏ|sửa\s*đổi)/iu
const compactWhitespace = (value: string | undefined): string | undefined => {
  const compact = value?.replace(/\s+/g, ' ').trim()
  return compact || undefined
}

function normalizeDocumentType(value: string | undefined): string | undefined {
  const compact = compactWhitespace(value)
  if (!compact) return undefined
  const labels: Record<string, string> = {
    consolidated_document: 'Văn bản hợp nhất',
    decree: 'Nghị định',
    circular: 'Thông tư',
    decision: 'Quyết định',
    resolution: 'Nghị quyết',
    directive: 'Chỉ thị',
    ordinance: 'Pháp lệnh',
    law: 'Luật',
    'văn bản hợp nhất': 'Văn bản hợp nhất',
    'nghị định': 'Nghị định',
    'thông tư': 'Thông tư',
    'quyết định': 'Quyết định',
    'nghị quyết': 'Nghị quyết',
    'chỉ thị': 'Chỉ thị',
    'pháp lệnh': 'Pháp lệnh',
    luật: 'Luật'
  }
  return labels[compact.toLocaleLowerCase('vi-VN')] || compact
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
}

function asStatus(value: unknown): LegalDocumentStatus {
  return typeof value === 'string' && (LEGAL_DOCUMENT_STATUSES as readonly string[]).includes(value)
    ? (value as LegalDocumentStatus)
    : 'unknown'
}

function isIsoDate(value: string | undefined): boolean {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function normalizeRuleText(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('vi-VN')
    .replace(/\bđiều\s+\d+[a-z]?\s*[.:-]?/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ruleSignature(value: string): { modality?: string; numbers: string[] } {
  const normalized = normalizeRuleText(value)
  const modality = normalized.match(/\b(không được|phải|được|có quyền|có thể)\b/u)?.[1]
  const numbers = normalized.match(/\b\d+(?:[.,]\d+)?\b/gu) || []
  return { modality, numbers }
}

function hasVerifiedApplicabilityMetadata(metadata: LegalDocumentMetadata): boolean {
  return metadata.status !== 'unknown' && isIsoDate(metadata.effectiveFrom)
}

function documentMetadataMissingFields(metadata: LegalDocumentMetadata): string[] {
  const fields: string[] = []
  if (metadata.status === 'unknown') fields.push('status')
  if (!isIsoDate(metadata.effectiveFrom)) fields.push('effectiveFrom')
  return fields
}

function documentTopic(evidence: LegalComparisonEvidence): string {
  const article = evidence.legalContext?.articleNumber
  const title = compactWhitespace(evidence.legalContext?.articleTitle)
  if (article && title) return `Điều ${article}: ${title}`
  if (article) return `Điều ${article}`
  return 'Nội dung truy vấn'
}

function isReplacement(current: LegalComparisonEvidence, previous: LegalComparisonEvidence): boolean {
  return (
    current.metadata.replacesDocumentIds.includes(previous.documentId) ||
    previous.metadata.repealedByDocumentIds.includes(current.documentId)
  )
}

function resolvePairRelation(
  left: LegalComparisonEvidence,
  right: LegalComparisonEvidence
): Pick<LegalComparisonRow, 'relation' | 'reason'> {
  if (isReplacement(right, left)) {
    return {
      relation: 'temporal_change',
      reason: `${right.documentTitle} có metadata thay thế hoặc bãi bỏ ${left.documentTitle}.`
    }
  }

  if (isReplacement(left, right)) {
    return {
      relation: 'temporal_change',
      reason: `${left.documentTitle} có metadata thay thế hoặc bãi bỏ ${right.documentTitle}.`
    }
  }

  const leftRule = normalizeRuleText(left.content)
  const rightRule = normalizeRuleText(right.content)
  if (leftRule && leftRule === rightRule) {
    return { relation: 'equivalent', reason: 'Hai evidence có cùng nội dung quy phạm sau chuẩn hóa.' }
  }

  if (left.metadata.scope && right.metadata.scope && left.metadata.scope !== right.metadata.scope) {
    return { relation: 'different_scope', reason: 'Metadata phạm vi áp dụng của hai văn bản khác nhau.' }
  }

  const leftSignature = ruleSignature(left.content)
  const rightSignature = ruleSignature(right.content)
  const sameTopic = documentTopic(left) === documentTopic(right)
  const differs =
    leftSignature.modality !== rightSignature.modality ||
    leftSignature.numbers.join('|') !== rightSignature.numbers.join('|')

  if (sameTopic && differs && leftSignature.modality && rightSignature.modality) {
    return {
      relation: 'potential_conflict',
      reason: 'Cùng chủ đề điều khoản nhưng dấu hiệu nghĩa vụ hoặc tham số định lượng khác nhau; cần đối chiếu phạm vi và hiệu lực.'
    }
  }

  return {
    relation: 'insufficient_evidence',
    reason: 'Evidence chưa đủ để xác định cùng nghĩa, bổ sung, khác phạm vi hoặc mâu thuẫn.'
  }
}

export function buildLegalDocumentMetadata(input: LegalDocumentMetadataInput): LegalDocumentMetadata {
  return {
    documentNumber: compactWhitespace(input.documentNumber),
    documentType: normalizeDocumentType(input.documentType),
    issuer: compactWhitespace(input.issuer),
    documentTitle: compactWhitespace(input.documentTitle),
    legalBases: input.legalBases?.trim() || undefined,
    jurisdiction: compactWhitespace(input.jurisdiction),
    issuedAt: compactWhitespace(input.issuedAt),
    effectiveFrom: compactWhitespace(input.effectiveFrom),
    effectiveTo: compactWhitespace(input.effectiveTo),
    status: asStatus(input.status),
    scope: compactWhitespace(input.scope),
    sourceAuthority: compactWhitespace(input.sourceAuthority),
    officialSourceUrl: compactWhitespace(input.officialSourceUrl),
    sourceHash: compactWhitespace(input.sourceHash),
    verifiedAt: compactWhitespace(input.verifiedAt),
    verifiedBy: compactWhitespace(input.verifiedBy),
    amendsDocumentIds: asStringArray(input.amendsDocumentIds),
    replacesDocumentIds: asStringArray(input.replacesDocumentIds),
    repealedByDocumentIds: asStringArray(input.repealedByDocumentIds)
  }
}

export function getLegalDocumentMetadata(metadata: unknown): LegalDocumentMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return buildLegalDocumentMetadata({})
  }

  const source = metadata as Record<string, unknown>
  const legalDocument = source.legalDocument
  if (!legalDocument || typeof legalDocument !== 'object' || Array.isArray(legalDocument)) {
    return buildLegalDocumentMetadata({})
  }

  return buildLegalDocumentMetadata(legalDocument as LegalDocumentMetadataInput)
}

export function isLegalApplicabilityQuery(query: string): boolean {
  return applicabilityPattern.test(query.normalize('NFC').trim())
}

export function isLegalComparisonQuery(query: string): boolean {
  const normalized = query.normalize('NFC').trim()
  return (
    (comparisonPattern.test(normalized) && applicabilityPattern.test(normalized)) ||
    /so\s*sánh/iu.test(normalized) ||
    /đối\s*chiếu/iu.test(normalized)
  )
}

export function validateComparisonCitations(
  response: string,
  validCitationIds: number[]
): { valid: boolean; invalidCitationIds: number[] } {
  const allowed = new Set(validCitationIds)
  const invalidCitationIds = [
    ...new Set(
      [...response.matchAll(/\[(\d+)\](?!\s*\()/g)].map((match) => Number(match[1])).filter((id) => !allowed.has(id))
    )
  ]
  return { valid: invalidCitationIds.length === 0, invalidCitationIds }
}

export function removeInvalidComparisonCitations(response: string, validCitationIds: number[]): string {
  const allowed = new Set(validCitationIds)
  return response.replace(/\[(\d+)\](?!\s*\()/g, (marker, rawId) =>
    allowed.has(Number(rawId)) ? marker : ''
  )
}

export function buildLegalComparisonContext(result: LegalComparisonResult): string {
  let evidenceChars = 0
  const evidenceBlocks = result.evidence
    .slice(0, 12)
    .map((item) => {
      const remaining = Math.max(0, 14000 - evidenceChars)
      if (remaining === 0) return ''
      const location = [
        item.legalContext?.articleNumber && `Điều ${item.legalContext.articleNumber}`,
        item.legalContext?.clauseNumber && `Khoản ${item.legalContext.clauseNumber}`,
        item.legalContext?.pointNumber && `Điểm ${item.legalContext.pointNumber}`
      ].filter(Boolean).join(', ')
      const content = item.content.length > Math.min(1600, remaining)
        ? `${item.content.slice(0, Math.min(1600, remaining) - 3).trimEnd()}...`
        : item.content
      evidenceChars += content.length
      return `<evidence citation="${item.citationId}" document="${item.documentTitle}" location="${location || 'không rõ'}">\n${content}\n</evidence>`
    })
    .filter(Boolean)
    .join('\n\n')

  const matrix = result.rows
    .map((row) => `- ${row.topic}: ${row.relation}; ${row.reason}; citations [${row.citationIds.join('], [')}].`)
    .join('\n')

  return `Bạn là generator trong Legal Comparison RAG của MiChat. Bạn không phải luật sư.\n\n<comparison-evidence>\n${evidenceBlocks}\n</comparison-evidence>\n\n<deterministic-matrix>\n${matrix || '- Chưa đủ evidence để lập ma trận.'}\n</deterministic-matrix>\n\n<resolution status="${result.resolution.status}">\n${result.resolution.reason}\n</resolution>\n\nQUY TẮC BẮT BUỘC:\n1. Chỉ dùng evidence và matrix được cấp; không dùng kiến thức ngoài.\n2. Không gọi là mâu thuẫn nếu matrix không ghi conflict.\n3. Nếu resolution là needs_metadata hoặc insufficient_evidence, không kết luận văn bản nào ưu tiên áp dụng.\n4. Mỗi nhận định về quy định phải có citation [n] đúng từ evidence.\n5. Nêu theo thứ tự: Kết luận, Điểm chung/khác biệt, Tình trạng hiệu lực, Giới hạn.\n6. Kết thúc bằng: "Thông tin tham khảo từ MiChat AI, không thay thế tư vấn pháp lý chuyên nghiệp; cần đối chiếu văn bản hiện hành."`
}

export class LegalComparisonService {
  compare(query: string, evidence: LegalComparisonEvidence[]): LegalComparisonResult {
    void query
    const uniqueEvidence = [...new Map(evidence.map((item) => [item.citationId, item])).values()]
    const byDocument = new Map<string, LegalComparisonEvidence[]>()

    for (const item of uniqueEvidence) {
      const entries = byDocument.get(item.documentId) || []
      entries.push(item)
      byDocument.set(item.documentId, entries)
    }

    const evidenceByDocument = [...byDocument.entries()].map(([documentId, entries]) => ({
      documentId,
      documentTitle: entries[0].documentTitle,
      metadata: entries[0].metadata,
      evidenceIds: entries.map((item) => item.citationId)
    }))

    const representatives = evidenceByDocument
      .map((group) => byDocument.get(group.documentId)!.slice().sort((left, right) => right.score - left.score)[0])
      .filter((item): item is LegalComparisonEvidence => !!item)

    const rows: LegalComparisonRow[] = []
    for (let leftIndex = 0; leftIndex < representatives.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < representatives.length; rightIndex++) {
        const left = representatives[leftIndex]
        const right = representatives[rightIndex]
        const outcome = resolvePairRelation(left, right)
        rows.push({
          topic: documentTopic(left),
          leftDocumentId: left.documentId,
          rightDocumentId: right.documentId,
          citationIds: [left.citationId, right.citationId],
          ...outcome
        })
      }
    }

    const metadataMissing = [...new Set(representatives.flatMap((item) => documentMetadataMissingFields(item.metadata)))]
    let resolution: LegalComparisonResolution
    if (representatives.length < 2) {
      resolution = {
        status: 'insufficient_evidence',
        reason: 'Cần evidence từ ít nhất hai văn bản để so sánh.',
        citationIds: representatives.map((item) => item.citationId)
      }
    } else if (metadataMissing.length > 0 || representatives.some((item) => !hasVerifiedApplicabilityMetadata(item.metadata))) {
      resolution = {
        status: 'needs_metadata',
        reason: 'Thiếu metadata hiệu lực đã xác minh; không thể kết luận văn bản ưu tiên áp dụng.',
        citationIds: representatives.map((item) => item.citationId),
        requiredMetadata: metadataMissing.length > 0 ? metadataMissing : ['effectiveFrom', 'status']
      }
    } else {
      const temporalRow = rows.find((row) => row.relation === 'temporal_change')
      if (temporalRow) {
        const preferred = representatives.find((item) => isReplacement(item, representatives.find((candidate) => candidate.documentId === temporalRow.leftDocumentId)!)) ||
          representatives.find((item) => isReplacement(item, representatives.find((candidate) => candidate.documentId === temporalRow.rightDocumentId)!))
        resolution = {
          status: 'resolved',
          reason: 'Có quan hệ thay thế hoặc bãi bỏ đã xác minh giữa các văn bản trong evidence.',
          preferredDocumentId: preferred?.documentId,
          citationIds: temporalRow.citationIds
        }
      } else {
        resolution = {
          status: 'insufficient_evidence',
          reason: 'Chưa có quan hệ thay thế, bãi bỏ hoặc sửa đổi đã xác minh để kết luận văn bản ưu tiên áp dụng.',
          citationIds: representatives.map((item) => item.citationId)
        }
      }
    }

    const limitations = [
      ...(representatives.length < 2 ? ['Chỉ truy xuất được evidence từ dưới hai văn bản.'] : []),
      ...(metadataMissing.length > 0 ? ['Metadata hiệu lực chưa đầy đủ hoặc chưa xác minh.'] : []),
      ...(rows.some((row) => row.relation === 'potential_conflict')
        ? ['Có khác biệt quy phạm; cần đối chiếu phạm vi áp dụng và quan hệ văn bản trước khi kết luận xung đột.']
        : [])
    ]

    return {
      mode: 'compare',
      evidence: uniqueEvidence,
      evidenceByDocument,
      rows,
      resolution,
      limitations
    }
  }
}
