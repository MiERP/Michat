export function redactSensitiveText(value: string): string {
  return value
    .replace(/[A-Z]:\\(?:[^\s<>:|?*]+\\)*[^\s<>:|?*]*/giu, '[ĐƯỜNG_DẪN_ĐÃ_ẨN]')
    .replace(/[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/giu, '[EMAIL_ĐÃ_ẨN]')
    .replace(/(?<!\d)(?:\+84|0)\d{9,10}(?!\d)/gu, '[SĐT_ĐÃ_ẨN]')
    .replace(/(?<!\d)\d{12}(?!\d)/gu, '[ĐỊNH_DANH_ĐÃ_ẨN]')
}

export function minimizeRemoteMessages<T extends { role: string; content: string }>(
  messages: T[]
): T[] {
  const evidence = messages
    .filter(
      (message) =>
        message.role === 'system' &&
        /<(?:documents|comparison-evidence|legal-evidence)>|QUY TẮC BẮT BUỘC/iu.test(
          message.content
        )
    )
    .slice(-2)
  const latestUser = messages.slice().reverse().find((message) => message.role === 'user')
  return [...evidence, ...(latestUser ? [latestUser] : [])].map((message) => ({
    ...message,
    content: redactSensitiveText(message.content)
  }))
}
