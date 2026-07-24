export type DocumentMetadataFieldStatus = 'extracted' | 'user_corrected' | 'unknown'

export interface DocumentMetadata {
  documentNumber?: string
  documentType?: string
  issuer?: string
  issuedAt?: string
  documentTitle?: string
  legalBases?: string
}

export interface DocumentMetadataEvidence {
  text: string
  startOffset: number
  endOffset: number
}

export interface DocumentMetadataField {
  value: string
  status: DocumentMetadataFieldStatus
  confidence: number
  evidence?: DocumentMetadataEvidence
}

export interface DocumentMetadataInspector {
  version: 1
  extractedAt: string
  fields: {
    documentNumber?: DocumentMetadataField
    documentType?: DocumentMetadataField
    issuer?: DocumentMetadataField
    issuedAt?: DocumentMetadataField
    documentTitle?: DocumentMetadataField
    legalBases?: DocumentMetadataField
  }
}

interface DocumentMetadataExtractionInput {
  title: string
  content: string
}

interface HeaderLine {
  text: string
  value: string
  startOffset: number
  endOffset: number
}

const DOCUMENT_TYPES: Array<[RegExp, string]> = [
  [/NGHỊ\s+ĐỊNH/iu, 'Nghị định'],
  [/THÔNG\s+TƯ/iu, 'Thông tư'],
  [/QUYẾT\s+ĐỊNH/iu, 'Quyết định'],
  [/NGHỊ\s+QUYẾT/iu, 'Nghị quyết'],
  [/CHỈ\s+THỊ/iu, 'Chỉ thị'],
  [/PHÁP\s+LỆNH/iu, 'Pháp lệnh'],
  [/LUẬT/iu, 'Luật']
]

const ISSUERS: Array<[RegExp, string]> = [
  [/QUỐC\s+HỘI/iu, 'Quốc hội'],
  [/CHÍNH\s+PHỦ/iu, 'Chính phủ'],
  [/ỦY\s+BAN\s+THƯỜNG\s+VỤ\s+QUỐC\s+HỘI/iu, 'Ủy ban Thường vụ Quốc hội'],
  [/THỦ\s+TƯỚNG\s+CHÍNH\s+PHỦ/iu, 'Thủ tướng Chính phủ']
]

const HEADER_LENGTH = 5000

function getHeaderLines(content: string): HeaderLine[] {
  const header = content.slice(0, HEADER_LENGTH)
  return [...header.matchAll(/[^\r\n]+/gu)].map((match) => ({
    text: match[0],
    value: match[0].replace(/\s+/g, ' ').trim(),
    startOffset: match.index || 0,
    endOffset: (match.index || 0) + match[0].length
  }))
}

function field(value: string, confidence: number, line?: HeaderLine): DocumentMetadataField {
  return {
    value,
    status: 'extracted',
    confidence,
    evidence: line
      ? { text: line.value, startOffset: line.startOffset, endOffset: line.endOffset }
      : undefined
  }
}

function fieldFromRange(
  value: string,
  confidence: number,
  content: string,
  startOffset: number,
  endOffset: number
): DocumentMetadataField {
  return field(value, confidence, {
    text: content.slice(startOffset, endOffset),
    value: content.slice(startOffset, endOffset).replace(/\s+/g, ' ').trim(),
    startOffset,
    endOffset
  })
}

function extractDocumentNumber(lines: HeaderLine[]): DocumentMetadataField | undefined {
  const candidates = lines.flatMap((line) =>
    [...line.value.matchAll(/\d{1,4}\s*\/\s*\d{4}\s*\/\s*[\p{L}\d]+(?:\s*-\s*[\p{L}\d]+)*/gu)].map(
      (match) => ({ line, value: match[0].replace(/\s*([/-])\s*/g, '$1') })
    )
  )
  const candidate = candidates.sort((left, right) => right.value.length - left.value.length)[0]
  return candidate ? field(candidate.value, 0.99, candidate.line) : undefined
}

function extractDocumentType(
  lines: HeaderLine[],
  content: string
): DocumentMetadataField | undefined {
  for (const line of lines) {
    const match = DOCUMENT_TYPES.find(([pattern]) => line.value.match(pattern)?.[0] === line.value)
    if (match) return field(match[1], 0.99, line)
  }

  const header = content.slice(0, HEADER_LENGTH)
  const candidate = DOCUMENT_TYPES.map(([pattern, value]) => {
    const match = header.match(pattern)
    return match?.index === undefined ? undefined : { match, value, index: match.index }
  })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((left, right) => left.index - right.index)[0]

  return candidate
    ? fieldFromRange(
        candidate.value,
        0.96,
        content,
        candidate.index,
        candidate.index + candidate.match[0].length
      )
    : undefined
}

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase('vi-VN')
    .replace(
      /(^|\s)(\p{L})/gu,
      (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('vi-VN')}`
    )
}

function extractIssuer(lines: HeaderLine[], content: string): DocumentMetadataField | undefined {
  for (const line of lines.slice(0, 12)) {
    const exact = ISSUERS.find(([pattern]) => line.value.match(pattern)?.[0] === line.value)
    if (exact) return field(exact[1], 0.98, line)
    if (/^(BỘ|TỔNG CỤC|CỤC|SỞ|ỦY BAN NHÂN DÂN)\s+/u.test(line.value)) {
      return field(titleCase(line.value), 0.94, line)
    }
  }

  const header = content.slice(0, HEADER_LENGTH)
  const canonical = ISSUERS.map(([pattern, value]) => {
    const match = header.match(pattern)
    return match?.index === undefined ? undefined : { match, value, index: match.index }
  })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((left, right) => left.index - right.index)[0]
  if (canonical) {
    return fieldFromRange(
      canonical.value,
      0.95,
      content,
      canonical.index,
      canonical.index + canonical.match[0].length
    )
  }

  const organization = header.match(
    /^\s*((?:BỘ|TỔNG CỤC|CỤC|SỞ|ỦY BAN NHÂN DÂN)\s+.{2,120}?)(?=\s+(?:-{2,}|CỘNG HÒA|Số\s*:))/iu
  )
  return organization?.index === undefined
    ? undefined
    : fieldFromRange(
        titleCase(organization[1]),
        0.9,
        content,
        organization.index,
        organization.index + organization[0].length
      )
}

function extractIssuedAt(lines: HeaderLine[]): DocumentMetadataField | undefined {
  for (const line of lines) {
    const match = line.value.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu)
    if (!match) continue
    const value = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
    return field(value, 0.97, line)
  }
  return undefined
}

function extractDocumentTitle(
  lines: HeaderLine[],
  documentType: DocumentMetadataField | undefined,
  content: string
): DocumentMetadataField | undefined {
  if (!documentType?.evidence) return undefined
  const typeIndex = lines.findIndex(
    (line) => line.startOffset === documentType.evidence?.startOffset
  )
  const titleLines: HeaderLine[] = []

  for (const line of lines.slice(typeIndex + 1)) {
    if (/^(Căn cứ|Theo đề nghị|Điều\s+\d+)/iu.test(line.value)) break
    if (!line.value || /^(CỘNG HÒA|Độc lập|Hà Nội)/iu.test(line.value)) continue
    if (line.value === line.value.toLocaleUpperCase('vi-VN')) titleLines.push(line)
    else if (titleLines.length > 0) break
  }

  if (titleLines.length > 0) {
    const value = titleLines.map((line) => line.value).join(' ')
    return field(value, 0.96, {
      text: value,
      value,
      startOffset: titleLines[0].startOffset,
      endOffset: titleLines[titleLines.length - 1].endOffset
    })
  }

  const header = content.slice(0, HEADER_LENGTH)
  const legalBasis = header.match(/Căn\s+cứ/iu)
  if (legalBasis?.index === undefined) return undefined
  const issuedAt = header.match(/ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}/iu)
  const startOffset =
    issuedAt?.index === undefined
      ? documentType.evidence.endOffset
      : issuedAt.index + issuedAt[0].length
  if (startOffset >= legalBasis.index) return undefined

  const rawTitle = header.slice(startOffset, legalBasis.index)
  const typePattern = DOCUMENT_TYPES.find(([, value]) => value === documentType.value)?.[0]
  const value = (
    typePattern ? rawTitle.replace(new RegExp(`^\\s*${typePattern.source}`, 'iu'), '') : rawTitle
  )
    .replace(/\s+/g, ' ')
    .trim()
  return value ? fieldFromRange(value, 0.93, content, startOffset, legalBasis.index) : undefined
}

function extractLegalBases(content: string): DocumentMetadataField | undefined {
  const header = content.slice(0, HEADER_LENGTH)
  const clauses = [...header.matchAll(/Căn\s+cứ[^;]{1,1500};/giu)]
  if (clauses.length === 0) return undefined
  const firstClause = clauses[0]
  const lastClause = clauses[clauses.length - 1]
  const startOffset = firstClause.index
  const endOffset = (lastClause.index || 0) + lastClause[0].length
  const value = clauses.map((match) => match[0].replace(/\s+/g, ' ').trim()).join('\n')
  return fieldFromRange(value, 0.92, content, startOffset, endOffset)
}

export function metadataFromInspector(inspector: DocumentMetadataInspector): DocumentMetadata {
  return Object.fromEntries(
    Object.entries(inspector.fields)
      .filter(
        (entry): entry is [keyof DocumentMetadata, DocumentMetadataField] => !!entry[1]?.value
      )
      .map(([key, metadataField]) => [key, metadataField.value])
  )
}

export function mergeDocumentMetadataInspector(
  extracted: DocumentMetadataInspector,
  existing?: DocumentMetadataInspector
): DocumentMetadataInspector {
  if (!existing) return extracted
  const fields = { ...extracted.fields }
  for (const [key, existingField] of Object.entries(existing.fields)) {
    if (existingField?.status === 'user_corrected') {
      fields[key as keyof DocumentMetadataInspector['fields']] = existingField
    }
  }
  return { ...extracted, fields }
}

export function inspectorFromMetadata(metadata: DocumentMetadata): DocumentMetadataInspector {
  return {
    version: 1,
    extractedAt: new Date().toISOString(),
    fields: Object.fromEntries(
      Object.entries(metadata)
        .filter((entry): entry is [keyof DocumentMetadata, string] => !!entry[1]?.trim())
        .map(([key, value]) => [key, { value, status: 'user_corrected', confidence: 1 }])
    )
  }
}

export function extractDocumentMetadata({ content }: DocumentMetadataExtractionInput): {
  metadata: DocumentMetadata
  inspector: DocumentMetadataInspector
} {
  const lines = getHeaderLines(content)
  const documentType = extractDocumentType(lines, content)
  const inspector: DocumentMetadataInspector = {
    version: 1,
    extractedAt: new Date().toISOString(),
    fields: {
      documentNumber: extractDocumentNumber(lines),
      documentType,
      issuer: extractIssuer(lines, content),
      issuedAt: extractIssuedAt(lines),
      documentTitle: extractDocumentTitle(lines, documentType, content),
      legalBases: extractLegalBases(content)
    }
  }
  return { metadata: metadataFromInspector(inspector), inspector }
}
