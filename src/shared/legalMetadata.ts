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

/** Heuristic used by both the extractor and the renderer badge. */
export function isOriginalLegalDocument(content: string): boolean {
  const opening = content.slice(0, 1500)
  if (/^\s*(?:BÁO\s+CÁO|PHÂN\s+TÍCH|NGHIÊN\s+CỨU)/iu.test(opening)) return false
  if (/^.{0,180}:\s*Phân\s+tích\s+(?:toàn\s+diện|chuyên\s+sâu)/iu.test(opening)) {
    return false
  }
  const hasOfficialHeader =
    /CỘNG\s+HÒA\s+XÃ\s+HỘI\s+CHỦ\s+NGHĨA\s+VIỆT\s+NAM/iu.test(opening) ||
    /ĐẢNG\s+CỘNG\s+SẢN\s+VIỆT\s+NAM/iu.test(opening)
  const hasDocumentNumber = /(?:Số|Luật\s+số)\s*:?\s*\d{1,4}\s*[-/]\s*[\p{L}\d]+/iu.test(opening)
  return hasOfficialHeader && hasDocumentNumber
}
