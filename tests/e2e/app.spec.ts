import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, expect, test } from '@playwright/test'

async function startFakeApi(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'test-chat' }, { id: 'test-embed' }] }))
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to start fake API')
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` }
}

test('boots into onboarding, then saves and tests an API configuration', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'michat-e2e-'))
  const { server, baseUrl } = await startFakeApi()

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env } as Record<string, string>
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.locator('h1')).toHaveText('MiChat')
    await window.getByRole('button', { name: /get started|bắt đầu/i }).click()

    await window.getByRole('button', { name: /settings|cài đặt/i }).click()
    await window.getByRole('button', { name: /local api|api cục bộ/i }).click()

    await window.getByLabel(/api base url|địa chỉ api/i).fill(baseUrl)
    await window.getByLabel(/^chat model$|mô hình chat/i).fill('test-chat')
    await window.getByLabel(/embedding model|mô hình embedding/i).fill('test-embed')

    await window.getByRole('button', { name: /test connection|kiểm tra kết nối/i }).click()
    await expect(window.getByText(/connection successful|kết nối thành công/i)).toBeVisible()

    await window.getByRole('button', { name: /save api settings|lưu cấu hình api/i }).click()
    await expect(window.getByText(/saved|đã lưu/iu)).toBeVisible()

    const saved = await window.evaluate(() => window.api.api.getConfig())
    expect(saved.baseUrl).toBe(baseUrl)
    expect(saved.chatModel).toBe('test-chat')
    expect(saved.embeddingModel).toBe('test-embed')
    expect(saved.hasApiKey).toBe(false)
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
