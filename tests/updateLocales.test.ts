import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function settings(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), 'src', 'renderer', 'src', 'locales', locale, 'settings.json'),
      'utf8'
    )
  ) as Record<string, string>
}

describe('update error locale strings', () => {
  it('matches the exact English values from SPEC §2', () => {
    const en = settings('en-US')
    expect(en.updateErrorFeedUnavailable).toBe(
      "Couldn't check for updates because the release feed is unavailable."
    )
    expect(en.updateErrorNetwork).toBe(
      "Couldn't reach the update server. Check your network and try again."
    )
    expect(en.updateErrorUnknown).toBe('Update check failed. Please try again.')
  })

  it('matches the exact Vietnamese values from SPEC §2', () => {
    const vi = settings('vi-VN')
    expect(vi.updateErrorFeedUnavailable).toBe(
      'Không thể kiểm tra cập nhật vì nguồn phát hành không truy cập được.'
    )
    expect(vi.updateErrorNetwork).toBe(
      'Không thể kết nối máy chủ cập nhật. Kiểm tra mạng rồi thử lại.'
    )
    expect(vi.updateErrorUnknown).toBe('Kiểm tra cập nhật thất bại. Vui lòng thử lại.')
  })
})
