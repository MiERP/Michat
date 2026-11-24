import { normalizeMetadataValue, type QueryMetadataSignals } from '../../utils/queryMetadata'

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values))
}

/**
 * Turn query metadata signals into a document-level metadata filter, but only
 * when the corpus makes the match unambiguous.
 */
export function selectLegalMetadataFilter(
  metadataList: Array<Record<string, string>>,
  signals: QueryMetadataSignals
): Record<string, string> | undefined {
  if (metadataList.length === 0) return undefined

  if (signals.documentNumber) {
    const target = normalizeMetadataValue(signals.documentNumber)
    const targetHasYear = /^\d{1,4}\d{4}[A-Z]/.test(target)
    const values = uniqueValues(
      metadataList
        .filter((metadata) => {
          if (!metadata.documentNumber) return false
          const stored = normalizeMetadataValue(metadata.documentNumber)
          if (targetHasYear) return stored === target || stored.includes(target)
          // User said "15/NQ-CP": compare against the stored number with year removed.
          return stored.replace(/^(\d{1,4})\d{4}(?=[A-Z])/, '$1') === target
        })
        .map((metadata) => metadata.documentNumber)
    )
    return values.length === 1 ? { documentNumber: values[0] } : undefined
  }

  const filters: Record<string, string> = {}

  if (signals.documentTypes.length === 1) {
    const target = normalizeMetadataValue(signals.documentTypes[0])
    const values = uniqueValues(
      metadataList
        .filter(
          (metadata) =>
            metadata.documentType && normalizeMetadataValue(metadata.documentType).includes(target)
        )
        .map((metadata) => metadata.documentType)
    )
    if (values.length === 1) filters.documentType = values[0]
  }

  if (signals.issuers.length === 1) {
    const target = normalizeMetadataValue(signals.issuers[0])
    const values = uniqueValues(
      metadataList
        .filter(
          (metadata) => metadata.issuer && normalizeMetadataValue(metadata.issuer).includes(target)
        )
        .map((metadata) => metadata.issuer)
    )
    if (values.length === 1) filters.issuer = values[0]
  }

  if (Object.keys(filters).length === 0) return undefined

  const matches = metadataList.filter((metadata) =>
    Object.entries(filters).every(([key, value]) =>
      normalizeMetadataValue(metadata[key] || '').includes(normalizeMetadataValue(value))
    )
  )

  return matches.length > 0 ? filters : undefined
}
