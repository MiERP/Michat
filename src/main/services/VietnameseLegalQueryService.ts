const GROUPS = [
  ['mức phạt', 'xử phạt', 'chế tài'],
  ['nghĩa vụ', 'phải', 'có trách nhiệm'],
  ['quyền', 'được phép', 'được'],
  ['hiệu lực', 'thời điểm áp dụng'],
  ['sửa đổi', 'thay thế', 'bãi bỏ']
] as const

export function expandVietnameseLegalQuery(query: string): string[] {
  const normalized = query.normalize('NFC').toLocaleLowerCase('vi-VN')
  const expanded = new Set<string>([query])
  for (const group of GROUPS) {
    if (group.some((term) => normalized.includes(term))) group.forEach((term) => expanded.add(term))
  }
  return [...expanded].slice(0, 6)
}
