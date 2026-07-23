import {
  buildLegalDocumentMetadata,
  type LegalDocumentMetadata
} from './LegalComparisonService'
import {
  getLegalContextAt,
  type LegalDocumentStructure
} from './LegalStructureService'

export type LegalMetadataFieldStatus =
  | 'extracted'
  | 'verified_from_document'
  | 'verified_from_official_source'
  | 'user_corrected'
  | 'conflicting'
  | 'unknown'

export interface LegalMetadataEvidence {
  text: string
  startOffset: number
  endOffset: number
  articleNumber?: string
}

export interface LegalMetadataField<T = string> {
  value: T
  status: LegalMetadataFieldStatus
  confidence: number
  evidence?: LegalMetadataEvidence
}

export interface DeclaredLegalRelation {
  type: 'amends' | 'replaces' | 'repeals'
  targetDocumentNumber: string
  confidence: number
  evidence: LegalMetadataEvidence
}

export interface LegalMetadataInspector {
  version: 1
  extractedAt: string
  fields: {
    documentNumber?: LegalMetadataField
    documentType?: LegalMetadataField
    issuer?: LegalMetadataField
    issuedAt?: LegalMetadataField
    documentTitle?: LegalMetadataField
    legalBases?: LegalMetadataField
    effectiveFrom?: LegalMetadataField
    effectiveTo?: LegalMetadataField
    status?: LegalMetadataField<LegalDocumentMetadata['status']>
    scope?: LegalMetadataField
    subjects?: LegalMetadataField
    sourceAuthority?: LegalMetadataField
    officialSourceUrl?: LegalMetadataField
    verifiedAt?: LegalMetadataField
    verifiedBy?: LegalMetadataField
  }
  declaredRelations: DeclaredLegalRelation[]
}

export interface LegalMetadataExtractionInput {
  title: string
  content: string
  structure?: LegalDocumentStructure
}

export interface LegalMetadataExtractionResult {
  legalDocument: LegalDocumentMetadata
  inspector: LegalMetadataInspector
}

const documentTypePatterns: Array<[RegExp, string]> = [
  [/\bvăn\s+bản\s+hợp\s+nhất\b/iu, 'Văn bản hợp nhất'],
  [/\bnghị\s+định\b/iu, 'Nghị định'],
  [/\bthông\s+tư\b/iu, 'Thông tư'],
  [/\bquyết\s+định\b/iu, 'Quyết định'],
  [/\bnghị\s+quyết\b/iu, 'Nghị quyết'],
  [/\bchỉ\s+thị\b/iu, 'Chỉ thị'],
  [/\bpháp\s+lệnh\b/iu, 'Pháp lệnh'],
  [/\bluật\b/iu, 'Luật']
]

const issuerPatterns: Array<[RegExp, string | ((match: RegExpMatchArray) => string)]> = [
  [/^\s*QUỐC HỘI\s*$/imu, 'Quốc hội'],
  [/^\s*CHÍNH PHỦ\s*$/imu, 'Chính phủ'],
  [/^\s*ỦY BAN THƯỜNG VỤ QUỐC HỘI\s*$/imu, 'Ủy ban Thường vụ Quốc hội'],
  [/^\s*THỦ TƯỚNG CHÍNH PHỦ\s*$/imu, 'Thủ tướng Chính phủ'],
  [/^\s*(BỘ\s+[^\n]{2,120})\s*$/imu, (match) => titleCaseIssuer(match[1])],
  [/^\s*(ỦY BAN NHÂN DÂN\s+[^\n]{2,120})\s*$/imu, (match) => titleCaseIssuer(match[1])]
]

function titleCaseIssuer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('vi-VN')
    .replace(/(^|\s)(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('vi-VN')}`)
}

interface HeaderLine {
  text: string
  value: string
  startOffset: number
  endOffset: number
}

function getHeaderLines(content: string): HeaderLine[] {
  const header = content.slice(0, 5000)
  return [...header.matchAll(/[^\r\n]+/gu)].map((match) => ({
    text: match[0],
    value: match[0].replace(/\s+/g, ' ').trim(),
    startOffset: match.index || 0,
    endOffset: (match.index || 0) + match[0].length
  }))
}

function formatIssuerLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN')
  const exact: Record<string, string> = {
    'quốc hội': 'Quốc hội',
    'chính phủ': 'Chính phủ',
    'ủy ban thường vụ quốc hội': 'Ủy ban Thường vụ Quốc hội',
    'thủ tướng chính phủ': 'Thủ tướng Chính phủ'
  }
  if (exact[normalized]) return exact[normalized]

  const organization = normalized.match(
    /^(bộ|tổng cục|cục|vụ|sở|ủy ban nhân dân|hội đồng nhân dân|văn phòng)\s+(.+)$/u
  )
  if (!organization) return titleCaseIssuer(value)

  const prefix = organization[1].replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('vi-VN'))
  const name = organization[2].replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('vi-VN'))
  return `${prefix} ${name}`
}

function toIsoDate(day: string, month: string, year: string): string | undefined {
  const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? undefined : iso
}

function evidenceFromMatch(
  content: string,
  match: RegExpMatchArray,
  structure?: LegalDocumentStructure
): LegalMetadataEvidence {
  void content
  const startOffset = match.index || 0
  const text = match[0].replace(/\s+/g, ' ').trim()
  const articleNumber = structure
    ? getLegalContextAt(structure, startOffset).articleNumber
    : undefined
  return {
    text,
    startOffset,
    endOffset: startOffset + match[0].length,
    articleNumber
  }
}

function fieldFromMatch(
  value: string,
  content: string,
  match: RegExpMatchArray,
  confidence: number,
  structure?: LegalDocumentStructure
): LegalMetadataField {
  return {
    value,
    status: 'extracted',
    confidence,
    evidence: evidenceFromMatch(content, match, structure)
  }
}

function extractDocumentNumber(content: string): LegalMetadataField | undefined {
  const header = content.slice(0, 5000)
  const matches = [
    ...header.matchAll(
      /(?:^|\n)\s*(?:(?:văn\s+bản\s+hợp\s+nhất|nghị\s+định|thông\s+tư|quyết\s+định|nghị\s+quyết|chỉ\s+thị|pháp\s+lệnh|luật)\s+)?số\s*:\s*([0-9]+[A-Z]?(?:\/[A-ZĐ0-9.]+(?:\s*-\s*[A-ZĐ0-9.]+)*){1,3})(?=\s|$)/gimu
    )
  ]
  const match = matches.sort((left, right) => right[1].length - left[1].length)[0]
  return match
    ? fieldFromMatch(match[1].replace(/\s*-\s*/gu, '-').toUpperCase(), content, match, 0.99)
    : undefined
}

function extractDocumentType(title: string, content: string): LegalMetadataField | undefined {
  const header = content.slice(0, 2000)
  const lines = [...header.matchAll(/^.*$/gmu)]

  for (const lineMatch of lines) {
    const line = lineMatch[0].trim()
    if (!line || line !== line.toLocaleUpperCase('vi-VN')) continue

    for (const [pattern, value] of documentTypePatterns) {
      const match = line.match(pattern)
      if (!match || match.index !== 0) continue
      const startOffset = (lineMatch.index || 0) + lineMatch[0].indexOf(match[0])
      return {
        value,
        status: 'extracted',
        confidence: 0.99,
        evidence: {
          text: match[0],
          startOffset,
          endOffset: startOffset + match[0].length
        }
      }
    }
  }

  const source = `${title}\n${header}`
  let bestMatch: { match: RegExpMatchArray; value: string } | undefined
  for (const [pattern, value] of documentTypePatterns) {
    const match = source.match(pattern)
    if (!match) continue
    if (!bestMatch || (match.index || 0) < (bestMatch.match.index || 0)) bestMatch = { match, value }
  }
  if (!bestMatch) return undefined

  const contentStart = Math.max(0, (bestMatch.match.index || 0) - title.length - 1)
  return {
    value: bestMatch.value,
    status: 'extracted',
    confidence: 0.96,
    evidence: {
      text: bestMatch.match[0],
      startOffset: contentStart,
      endOffset: contentStart + bestMatch.match[0].length
    }
  }
}

function extractIssuer(content: string): LegalMetadataField | undefined {
  const lines = getHeaderLines(content)
  const nationalHeaderIndex = lines.findIndex((line) => /^CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM$/iu.test(line.value))
  if (nationalHeaderIndex > 0) {
    // ponytail: text-order parser stops at interleaved PDF columns; upgrade to coordinate blocks when loader exposes glyph positions.
    const issuerLines = lines
      .slice(0, nationalHeaderIndex)
      .filter(
        (line) =>
          line.value &&
          !/^-{2,}$/u.test(line.value) &&
          !/(?:^|\s)số\s*:/iu.test(line.value)
      )
      .slice(0, 2)
    if (issuerLines.length) {
      const value = issuerLines
        .map((line) => formatIssuerLine(line.value))
        .reverse()
        .join(' / ')
      return {
        value,
        status: 'extracted',
        confidence: issuerLines.length === 1 ? 0.98 : 0.94,
        evidence: {
          text: issuerLines.map((line) => line.value).join('\n'),
          startOffset: issuerLines[0].startOffset,
          endOffset: issuerLines[issuerLines.length - 1].endOffset
        }
      }
    }
  }

  const header = content.slice(0, 5000)
  for (const [pattern, rawValue] of issuerPatterns) {
    const match = header.match(pattern)
    if (!match) continue
    const value = typeof rawValue === 'function' ? rawValue(match) : rawValue
    return fieldFromMatch(value, content, match, 0.98)
  }
  return undefined
}

function extractDocumentTitle(
  content: string,
  documentType: LegalMetadataField | undefined
): LegalMetadataField | undefined {
  const lines = getHeaderLines(content)
  const typeEvidence = documentType?.evidence
  if (!typeEvidence) return undefined
  const typeOffset = typeEvidence.startOffset
  const typeLineIndex = lines.findIndex(
    (line) => line.startOffset <= typeOffset && line.endOffset >= typeOffset
  )
  if (typeLineIndex < 0) return undefined

  const typeLine = lines[typeLineIndex]
  const inlineTitle = typeLine.text
    .slice((typeEvidence.endOffset || typeLine.endOffset) - typeLine.startOffset)
    .trim()
  if (inlineTitle) {
    const startOffset = typeLine.endOffset - inlineTitle.length
    return {
      value: inlineTitle,
      status: 'extracted',
      confidence: 0.96,
      evidence: { text: inlineTitle, startOffset, endOffset: typeLine.endOffset }
    }
  }

  const titleLines: HeaderLine[] = []
  for (const line of lines.slice(typeLineIndex + 1)) {
    if (/^(?:căn\s+cứ|theo\s+đề\s+nghị)(?:\s|$)|^(?:chương\s+[IVXLCDM]+|điều\s+\d+)/iu.test(line.value)) break
    if (/\b(?:ban\s+hành|quyết\s+định)\s*:?$/iu.test(line.value)) break
    if (!line.value || /^-{2,}$/u.test(line.value)) continue
    titleLines.push(line)
  }
  if (!titleLines.length) return undefined

  return {
    value: titleLines.map((line) => line.value).join(' '),
    status: 'extracted',
    confidence: 0.96,
    evidence: {
      text: titleLines.map((line) => line.value).join('\n'),
      startOffset: titleLines[0].startOffset,
      endOffset: titleLines[titleLines.length - 1].endOffset
    }
  }
}

function extractLegalBases(
  content: string,
  documentTitle: LegalMetadataField | undefined
): LegalMetadataField | undefined {
  const lines = getHeaderLines(content)
  const afterTitle = documentTitle?.evidence?.endOffset || 0
  const startIndex = lines.findIndex(
    (line) =>
      line.startOffset >= afterTitle &&
      (/^(?:căn\s+cứ|theo\s+đề\s+nghị)(?:\s|$)/iu.test(line.value) ||
        /\b(?:ban\s+hành|quyết\s+định)\s*:?$/iu.test(line.value))
  )
  if (startIndex < 0) return undefined

  const basisLines: HeaderLine[] = []
  for (const line of lines.slice(startIndex)) {
    if (/^(chương\s+[IVXLCDM]+|điều\s+\d+)/iu.test(line.value)) break
    if (!line.value || /^-{2,}$/u.test(line.value)) continue
    basisLines.push(line)
  }
  if (!basisLines.length) return undefined

  return {
    value: basisLines.map((line) => line.value).join('\n'),
    status: 'extracted',
    confidence: 0.94,
    evidence: {
      text: basisLines.map((line) => line.value).join('\n'),
      startOffset: basisLines[0].startOffset,
      endOffset: basisLines[basisLines.length - 1].endOffset
    }
  }
}

function extractIssuedAt(content: string): LegalMetadataField | undefined {
  const header = content.slice(0, 5000)
  const match = header.match(/(?:Hà Nội|[^\n,]{2,80}),?\s*ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu)
  if (!match) return undefined
  const value = toIsoDate(match[1], match[2], match[3])
  return value ? fieldFromMatch(value, content, match, 0.97) : undefined
}

function extractEffectiveFrom(
  content: string,
  structure?: LegalDocumentStructure
): LegalMetadataField | undefined {
  const match = content.match(/có\s+hiệu\s+lực(?:\s+thi\s+hành)?\s+(?:kể\s+)?từ\s+ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu)
  if (!match) return undefined
  const value = toIsoDate(match[1], match[2], match[3])
  return value ? fieldFromMatch(value, content, match, 0.98, structure) : undefined
}

function extractArticleField(
  content: string,
  structure: LegalDocumentStructure | undefined,
  titlePattern: RegExp
): LegalMetadataField | undefined {
  if (!structure) return undefined
  const articleIndex = structure.articles.findIndex((article) => titlePattern.test(article.title))
  if (articleIndex < 0) return undefined
  const article = structure.articles[articleIndex]
  const nextArticle = structure.articles[articleIndex + 1]
  const endOffset = nextArticle?.startOffset || content.length
  const fullText = content.slice(article.startOffset, endOffset).trim()
  const body = fullText.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()
  const value = (body || fullText).slice(0, 1200)
  return {
    value,
    status: 'extracted',
    confidence: 0.94,
    evidence: {
      text: fullText.slice(0, 1500),
      startOffset: article.startOffset,
      endOffset: Math.min(endOffset, article.startOffset + 1500),
      articleNumber: article.number
    }
  }
}

function extractDeclaredRelations(
  content: string,
  structure?: LegalDocumentStructure
): DeclaredLegalRelation[] {
  const relations: DeclaredLegalRelation[] = []
  const pattern = /(thay\s+thế|bãi\s+bỏ|sửa\s+đổi(?:\s*,\s*bổ\s+sung)?)\s+(?:(?:luật|nghị\s+định|thông\s+tư|quyết\s+định|nghị\s+quyết|pháp\s+lệnh)\s+)?(?:số\s+)?([0-9]+[A-Z]?\/[0-9]{4}\/[A-ZĐ0-9-]+)/giu
  for (const match of content.matchAll(pattern)) {
    const action = match[1].toLocaleLowerCase('vi-VN')
    const type = action.startsWith('thay') ? 'replaces' : action.startsWith('bãi') ? 'repeals' : 'amends'
    relations.push({
      type,
      targetDocumentNumber: match[2].toUpperCase(),
      confidence: 0.96,
      evidence: evidenceFromMatch(content, match, structure)
    })
  }
  return relations
}

export function mergeLegalMetadataInspector(
  extracted: LegalMetadataInspector,
  existing: LegalMetadataInspector | undefined
): LegalMetadataInspector {
  if (!existing) return extracted
  const fields = { ...extracted.fields }
  for (const [name, field] of Object.entries(existing.fields)) {
    if (
      field &&
      (field.status === 'user_corrected' || field.status === 'verified_from_official_source')
    ) {
      Object.assign(fields, { [name]: field })
    }
  }
  return {
    ...extracted,
    fields,
    declaredRelations: extracted.declaredRelations
  }
}

export function materializeLegalDocumentMetadata(
  inspector: LegalMetadataInspector,
  existing?: LegalDocumentMetadata
): LegalDocumentMetadata {
  return buildLegalDocumentMetadata({
    ...(existing || {}),
    documentNumber: inspector.fields.documentNumber?.value || existing?.documentNumber,
    documentType: inspector.fields.documentType?.value || existing?.documentType,
    issuer: inspector.fields.issuer?.value || existing?.issuer,
    documentTitle: inspector.fields.documentTitle?.value || existing?.documentTitle,
    legalBases: inspector.fields.legalBases?.value || existing?.legalBases,
    issuedAt: inspector.fields.issuedAt?.value || existing?.issuedAt,
    effectiveFrom: inspector.fields.effectiveFrom?.value || existing?.effectiveFrom,
    effectiveTo: inspector.fields.effectiveTo?.value || existing?.effectiveTo,
    scope: inspector.fields.scope?.value || existing?.scope,
    status: inspector.fields.status?.value || existing?.status || 'unknown',
    sourceAuthority: inspector.fields.sourceAuthority?.value || existing?.sourceAuthority,
    officialSourceUrl: inspector.fields.officialSourceUrl?.value || existing?.officialSourceUrl,
    verifiedAt: inspector.fields.verifiedAt?.value || existing?.verifiedAt,
    verifiedBy: inspector.fields.verifiedBy?.value || existing?.verifiedBy,
    amendsDocumentIds: existing?.amendsDocumentIds || [],
    replacesDocumentIds: existing?.replacesDocumentIds || [],
    repealedByDocumentIds: existing?.repealedByDocumentIds || []
  })
}

export function extractLegalMetadataFromDocument(
  input: LegalMetadataExtractionInput
): LegalMetadataExtractionResult {
  const documentType = extractDocumentType(input.title, input.content)
  const documentTitle = extractDocumentTitle(input.content, documentType)
  const inspector: LegalMetadataInspector = {
    version: 1,
    extractedAt: new Date().toISOString(),
    fields: {
      documentNumber: extractDocumentNumber(input.content),
      documentType,
      issuer: extractIssuer(input.content),
      issuedAt: extractIssuedAt(input.content),
      documentTitle,
      legalBases: extractLegalBases(input.content, documentTitle),
      effectiveFrom: extractEffectiveFrom(input.content, input.structure),
      scope: extractArticleField(input.content, input.structure, /phạm\s+vi\s+điều\s+chỉnh/iu),
      subjects: extractArticleField(input.content, input.structure, /đối\s+tượng\s+áp\s+dụng/iu)
    },
    declaredRelations: extractDeclaredRelations(input.content, input.structure)
  }

  return {
    inspector,
    legalDocument: materializeLegalDocumentMetadata(inspector)
  }
}
