import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { _electron as electron, expect, test } from '@playwright/test'

test('boots into onboarding and exposes the main actions', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'michat-e2e-'))

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env } as Record<string, string>
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await expect(window.locator('h1')).toHaveText('MiChat')
    await expect(window.getByRole('button', { name: /get started|bắt đầu/i })).toBeVisible()
  } finally {
    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
  }
})
