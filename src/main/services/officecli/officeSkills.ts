/**
 * Skill officecli dùng cho trợ lý văn phòng. Tách riêng khỏi OfficeAgentService
 * (module nhẹ, không kéo theo provider/config) để test và dùng ở IPC.
 *
 * Danh sách này phải khớp với OFFICE_SKILL_OPTIONS trong OfficePage (renderer).
 */

export type OfficeDocumentKind = 'docx' | 'xlsx' | 'pptx'

export const OFFICE_SKILLS = [
  'auto',
  'officecli-docx',
  'officecli-word-form',
  'officecli-academic-paper',
  'officecli-xlsx',
  'officecli-financial-model',
  'officecli-data-dashboard',
  'officecli-pptx',
  'officecli-pitch-deck',
  'morph-ppt',
  'morph-ppt-3d'
] as const

export type OfficeSkill = (typeof OFFICE_SKILLS)[number]

/** Skill mặc định khi người dùng để 'auto'. */
export const SKILL_BY_KIND: Record<OfficeDocumentKind, OfficeSkill> = {
  docx: 'officecli-docx',
  xlsx: 'officecli-xlsx',
  pptx: 'officecli-pptx'
}

export function resolveOfficeSkill(
  kind: OfficeDocumentKind,
  skill?: OfficeSkill | null
): OfficeSkill {
  return skill && skill !== 'auto' ? skill : SKILL_BY_KIND[kind]
}
