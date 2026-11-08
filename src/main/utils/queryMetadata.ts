export interface QueryMetadataSignals {
  documentNumber?: string
  documentTypes: string[]
  issuers: string[]
}

/** Bỏ dấu/không phân biệt hoa thường để so khớp metadata lưu trong DB. */
export function normalizeMetadataValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function normalizeQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

const DOCUMENT_NUMBER_PATTERNS = [
  /\b\d{1,4}\s*\/\s*\d{4}\s*\/\s*[a-z][a-z0-9-]{1,10}\b/g, // 15/2024/NĐ-CP
  /\b\d{1,4}\s*\/\s*[a-z][a-z0-9-]{1,10}\b/g, // 15/NQ-CP
  /\b\d{1,4}\s*-\s*[a-z]{1,6}\s*\/\s*[a-z]{1,6}\b/g // 08-NQ/TW
]

const DOCUMENT_TYPE_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: 'NGHI DINH', pattern: /\bnghi\s*dinh\b/ },
  { value: 'THONG TU', pattern: /\bthong\s*tu\b/ },
  { value: 'QUYET DINH', pattern: /\bquyet\s*dinh\b/ },
  { value: 'NGHI QUYET', pattern: /\bnghi\s*quyet\b/ },
  { value: 'CHI THI', pattern: /\bchi\s*thi\b/ },
  { value: 'PHAP LENH', pattern: /\bphap\s*lenh\b/ },
  { value: 'LUAT', pattern: /\bluat\b/ }
]

const ISSUER_PATTERNS: Array<{ value: string; pattern: RegExp }> = [
  { value: 'CHINH PHU', pattern: /\bchinh\s*phu\b/ },
  { value: 'QUOC HOI', pattern: /\bquoc\s*hoi\b/ },
  { value: 'BO TU PHAP', pattern: /\bbo\s*tu\s*phap\b/ },
  { value: 'BO CONG AN', pattern: /\bbo\s*cong\s*an\b/ },
  { value: 'BO TAI CHINH', pattern: /\bbo\s*tai\s*chinh\b/ },
  { value: 'BO GIAO DUC VA DAO TAO', pattern: /\bbo\s*giao\s*duc\b/ },
  { value: 'UY BAN NHAN DAN', pattern: /\buy\s*ban\s*nhan\s*dan\b/ },
  { value: 'THU TUONG CHINH PHU', pattern: /\bthu\s*tuong\b/ }
]

/**
 * Nhận diện tín hiệu metadata ngay trong câu hỏi để retrieval tự áp filter,
 * không cần người dùng chọn tay. Chỉ trả tín hiệu; KnowledgeService sẽ đối
 * chiếu với metadata thật đã lưu trước khi quyết định lọc.
 */
export function detectQueryMetadata(query: string): QueryMetadataSignals {
  const normalized = normalizeQuery(query)
  const result: QueryMetadataSignals = { documentTypes: [], issuers: [] }

  for (const pattern of DOCUMENT_NUMBER_PATTERNS) {
    const matches = normalized.match(pattern)
    if (!matches?.length) continue
    // Hai số hiệu trở lên (câu so sánh) là mơ hồ — không tự lọc theo một số.
    if (matches.length === 1) {
      result.documentNumber = matches[0].replace(/\s+/g, '').toUpperCase()
    }
    break
  }

  for (const { value, pattern } of DOCUMENT_TYPE_PATTERNS) {
    if (pattern.test(normalized)) result.documentTypes.push(value)
  }

  for (const { value, pattern } of ISSUER_PATTERNS) {
    if (pattern.test(normalized)) result.issuers.push(value)
  }

  result.documentTypes = Array.from(new Set(result.documentTypes))
  result.issuers = Array.from(new Set(result.issuers))
  return result
}
