/**
 * Prompt builders cho Office Agent — tách riêng để không kéo theo dependency
 * nặng (provider/config) khi test.
 */

/** Thay placeholder trong system prompt template. */
export function buildOfficeAgentPrompt(
  template: string,
  vars: { file: string; kind: string; title: string }
): string {
  return template
    .replace(/\{\{FILE\}\}/g, vars.file)
    .replace(/\{\{KIND\}\}/g, vars.kind)
    .replace(/\{\{TITLE\}\}/g, vars.title)
}

export interface OfficeUserPromptInput {
  instruction?: string
  skill: string
  attempt: number
  sourceContent: string
  /** true = đang chỉnh sửa một tài liệu Office có sẵn (đã copy sang file đích) */
  isEdit?: boolean
}

/** Prompt gửi cho model ở mỗi lượt soạn tài liệu. */
export function buildOfficeAgentUserPrompt(input: OfficeUserPromptInput): string {
  const parts: string[] = []
  if (input.instruction?.trim()) {
    parts.push(`Yêu cầu của người dùng:\n${input.instruction.trim()}`)
  }
  parts.push(`Hãy bắt đầu bằng load_skill("${input.skill}").`)

  if (input.isEdit) {
    parts.push(
      'Đây là tài liệu CÓ SẴN cần CHỈNH SỬA (đã được sao chép sang file đích). Hãy dùng view/get để đọc cấu trúc hiện tại, sau đó sửa bằng set/add/remove — GIỮ LẠI nội dung không liên quan tới yêu cầu.'
    )
  }

  if (input.attempt > 1) {
    parts.push(
      'LƯU Ý: tài liệu vẫn đang TRỐNG sau lượt trước. Hãy gọi add/set để ghi nội dung NGAY, đừng chỉ mô tả kế hoạch.'
    )
  }

  if (!input.isEdit) {
    parts.push(
      'Nguồn tri thức (chỉ dùng nội dung dưới đây, không bịa thêm):',
      input.sourceContent.trim() || '(không có nội dung nguồn)'
    )
  } else if (input.sourceContent.trim()) {
    parts.push('Nguồn tham khảo thêm (nếu cần):', input.sourceContent.trim())
  }

  return parts.join('\n\n')
}
