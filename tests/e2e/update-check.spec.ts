import { createServer, type Server } from 'http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const EVIDENCE_DIR =
  process.env.MICHAT_EVIDENCE_DIR ||
  join(process.cwd(), '.opencode', 'evidence', 'update-check-local')

const appVersion = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
).version

const UPDATE_CONFIG_PATH = join(process.cwd(), 'dev-app-update.yml')
const originalUpdateConfig = readFileSync(UPDATE_CONFIG_PATH, 'utf8')
const DUMMY_SHA512 = Buffer.alloc(64).toString('base64')

// A killed worker must not leave the tracked dev feed pointing at a dead
// localhost fixture. Synchronous write is safe in an exit handler.
process.once('exit', () => {
  try {
    writeFileSync(UPDATE_CONFIG_PATH, originalUpdateConfig, 'utf8')
  } catch {
    // Best effort during process teardown.
  }
})

mkdirSync(EVIDENCE_DIR, { recursive: true })

type FeedMode = 'success' | 'feed-404' | 'check-500' | 'installer-500' | 'installer-network'

function latestYml(version: string, fileUrl?: string): string {
  const file = fileUrl ?? `michat-${version}-setup.exe`
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${DUMMY_SHA512}`,
    '    size: 100',
    `path: ${file}`,
    `sha512: ${DUMMY_SHA512}`,
    "releaseDate: '2026-11-27T00:00:00.000Z'",
    ''
  ].join('\n')
}

async function startFeed(
  mode: FeedMode,
  installerUrl?: string
): Promise<{ server: Server; url: string; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    requests.push(pathname)
    if (mode === 'success' && pathname === '/latest.yml') {
      response.writeHead(200, { 'Content-Type': 'text/yaml' })
      response.end(latestYml('2.2.3'))
      return
    }
    if (mode === 'feed-404' && pathname === '/latest.yml') {
      response.writeHead(404, {
        'Content-Type': 'text/plain',
        'Set-Cookie': '_gh_sess=fake-session; HttpOnly; secure',
        'Content-Security-Policy': "default-src 'none'"
      })
      response.end('404 releases.atom Headers: { set-cookie: _gh_sess=fake-session }')
      return
    }
    if (mode === 'check-500' && pathname === '/latest.yml') {
      response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end('server exploded')
      return
    }
    if ((mode === 'installer-500' || mode === 'installer-network') && pathname === '/latest.yml') {
      response.writeHead(200, { 'Content-Type': 'text/yaml' })
      response.end(latestYml('2.2.5', installerUrl))
      return
    }
    if (mode === 'installer-500' && pathname.includes('michat-2.2.5-setup.exe')) {
      response.writeHead(500, {
        'Content-Type': 'text/plain',
        'Set-Cookie': '_gh_sess=fake-session; HttpOnly; secure'
      })
      response.end('Headers: { set-cookie: _gh_sess=fake-session }')
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to start feed')
  return { server, url: `http://127.0.0.1:${address.port}/`, requests }
}

async function closedLoopbackUrl(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to reserve port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `http://127.0.0.1:${address.port}/`
}

function writeUpdateConfig(url: string): void {
  writeFileSync(
    UPDATE_CONFIG_PATH,
    ['provider: generic', `url: ${url}`, 'updaterCacheDirName: michat-updater-e2e', ''].join('\n'),
    'utf8'
  )
}

function restoreUpdateConfig(): void {
  writeFileSync(UPDATE_CONFIG_PATH, originalUpdateConfig, 'utf8')
}

async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication
  page: Page
  dialogs: string[]
  stderr: string[]
  errors: string[]
}> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MICHAT_E2E_OFFSCREEN: '1'
    } as Record<string, string>
  })
  const page = await app.firstWindow()
  const dialogs: string[] = []
  const stderr: string[] = []
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  app.process().stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  await page.waitForLoadState('domcontentloaded')

  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(0)
  expect(bounds.y).toBeLessThanOrEqual(0)

  return { app, page, dialogs, stderr, errors }
}

async function completeOnboarding(page: Page): Promise<void> {
  const start = page.getByRole('button', { name: /get started|bắt đầu/i })
  const create = page.locator('[data-testid="create-notebook"]')
  await expect(start.or(create).first()).toBeVisible({ timeout: 15_000 })
  if (await start.isVisible().catch(() => false)) {
    await start.click()
  }
  await expect(create).toBeVisible({ timeout: 15_000 })
}

async function openAbout(page: Page): Promise<void> {
  await page.locator('[data-testid="open-settings"]').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button', { name: /about|giới thiệu/i })
    .first()
    .click()
  await expect(page.getByText(`v${appVersion}`)).toBeVisible()
}

async function checkForUpdates(page: Page): Promise<void> {
  await page.getByRole('button', { name: /check updates|kiểm tra cập nhật/i }).click()
}

async function updateState(page: Page): Promise<{
  status: string
  error?: string
  errorKind?: string
}> {
  const result = await page.evaluate(() => window.api.update.getState())
  return result.state ?? { status: 'idle' }
}

async function collector(page: Page): Promise<unknown[]> {
  return page.evaluate(
    () => (window as unknown as { __michatUpdateStates: unknown[] }).__michatUpdateStates
  )
}

async function attachCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __michatUpdateStates: unknown[] }
    state.__michatUpdateStates = []
    window.api.update.onStateChanged((next) => {
      state.__michatUpdateStates.push(next)
    })
  })
}

function removeTempDir(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  } catch {
    // Chromium cache handles can linger briefly; not a verification failure.
  }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test.describe.configure({ mode: 'serial' })

test.describe('MiChat 2.2.4 update checks', () => {
  test.afterEach(() => {
    restoreUpdateConfig()
  })

  test.afterAll(() => {
    restoreUpdateConfig()
  })

  test('AC-01/AC-05 — success feed reaches NOT_AVAILABLE and About shows 2.2.4', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'michat-update-success-'))
    const { server, url, requests } = await startFeed('success')
    writeUpdateConfig(url)
    const launched = await launchApp(directory)
    try {
      await completeOnboarding(launched.page)
      await openAbout(launched.page)
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-05-about-version.png')
      })
      // Let the silent 5-second startup check settle, then prove the manual
      // click performs a fresh check.
      await launched.page.waitForTimeout(6_500)
      requests.length = 0
      await attachCollector(launched.page)
      await checkForUpdates(launched.page)
      await expect(
        launched.page.getByText(/you are on the latest version|bạn đang dùng phiên bản mới nhất/i)
      ).toBeVisible({ timeout: 30_000 })
      expect(requests).toContain('/latest.yml')
      const states = await collector(launched.page)
      expect(states.some((state) => (state as { status?: string }).status === 'checking')).toBe(
        true
      )
      expect((states[states.length - 1] as { status?: string } | undefined)?.status).toBe(
        'not-available'
      )
      const state = await updateState(launched.page)
      expect(state.status).toBe('not-available')
      expect(state.errorKind).toBeUndefined()
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-01-update-check-success.png')
      })
      expect(launched.dialogs).toEqual([])
      expect(launched.errors).toEqual([])
    } finally {
      await launched.app.close().catch(() => undefined)
      await closeServer(server)
      restoreUpdateConfig()
      removeTempDir(directory)
    }
  })

  test('AC-02 — 404 feed shows a sanitized localized error and no native dialog', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'michat-update-404-'))
    const { server, url } = await startFeed('feed-404')
    writeUpdateConfig(url)
    const launched = await launchApp(directory)
    try {
      await completeOnboarding(launched.page)
      await openAbout(launched.page)
      await checkForUpdates(launched.page)
      await expect(
        launched.page.getByText(
          /couldn't check for updates because the release feed is unavailable|không thể kiểm tra cập nhật vì nguồn phát hành không truy cập được/i
        )
      ).toBeVisible({ timeout: 30_000 })
      const state = await updateState(launched.page)
      expect(state.status).toBe('error')
      expect(state.errorKind).toBe('feed-unavailable')
      const body = await launched.page.locator('body').innerText()
      expect(body).not.toMatch(/_gh_sess|set-cookie|content-security-policy|headers:/i)
      expect(launched.dialogs).toEqual([])
      expect(launched.errors).toEqual([])
      expect(launched.stderr.join('')).not.toMatch(
        /_gh_sess|set-cookie|content-security-policy|headers:/i
      )
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-02-update-error-friendly.png')
      })
    } finally {
      await launched.app.close().catch(() => undefined)
      await closeServer(server)
      restoreUpdateConfig()
      removeTempDir(directory)
    }
  })

  test('AC-03 — network and unknown failures use the exact localized messages', async () => {
    const networkUrl = await closedLoopbackUrl()
    const scenarios = [
      {
        mode: 'network' as const,
        url: networkUrl,
        text: /couldn't reach the update server\. check your network and try again|không thể kết nối máy chủ cập nhật\. kiểm tra mạng rồi thử lại/i,
        screenshot: 'ac-03-network-error.png',
        kind: 'network'
      },
      {
        mode: 'check-500' as const,
        url: '',
        text: /update check failed\. please try again|kiểm tra cập nhật thất bại\. vui lòng thử lại/i,
        screenshot: 'ac-03-unknown-error.png',
        kind: 'unknown'
      }
    ]

    for (const scenario of scenarios) {
      const directory = mkdtempSync(join(tmpdir(), `michat-update-${scenario.mode}-`))
      const serverInfo = scenario.mode === 'check-500' ? await startFeed('check-500') : null
      writeUpdateConfig(serverInfo?.url ?? scenario.url)
      const launched = await launchApp(directory)
      try {
        await completeOnboarding(launched.page)
        await openAbout(launched.page)
        await checkForUpdates(launched.page)
        await expect(launched.page.getByText(scenario.text)).toBeVisible({ timeout: 30_000 })
        const state = await updateState(launched.page)
        expect(state.status).toBe('error')
        expect(state.errorKind).toBe(scenario.kind)
        expect(launched.dialogs).toEqual([])
        expect(launched.errors).toEqual([])
        await launched.page.screenshot({
          path: join(EVIDENCE_DIR, scenario.screenshot)
        })
      } finally {
        await launched.app.close().catch(() => undefined)
        await closeServer(serverInfo?.server ?? null)
        restoreUpdateConfig()
        removeTempDir(directory)
      }
    }
  })

  test('AC-03 — failed download shows the localized unknown error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'michat-update-download-'))
    const { server, url, requests } = await startFeed('installer-500')
    writeUpdateConfig(url)
    const launched = await launchApp(directory)
    try {
      await completeOnboarding(launched.page)
      await openAbout(launched.page)
      await launched.page.waitForTimeout(6_500)
      requests.length = 0
      await checkForUpdates(launched.page)
      expect(requests).toContain('/latest.yml')
      await expect(
        launched.page.getByText(/new version 2\.2\.5 available|phát hiện phiên bản mới 2\.2\.5/i)
      ).toBeVisible({ timeout: 30_000 })
      await launched.page.getByRole('button', { name: /download update|tải bản cập nhật/i }).click()
      await expect(
        launched.page.getByText(
          /update check failed\. please try again|kiểm tra cập nhật thất bại\. vui lòng thử lại/i
        )
      ).toBeVisible({ timeout: 30_000 })
      const state = await updateState(launched.page)
      expect(state.status).toBe('error')
      expect(state.errorKind).toBe('unknown')
      expect(launched.dialogs).toEqual([])
      expect(launched.errors).toEqual([])
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-03-download-error.png')
      })
    } finally {
      await launched.app.close().catch(() => undefined)
      await closeServer(server)
      restoreUpdateConfig()
      removeTempDir(directory)
    }
  })

  test('AC-03 — refused download connection shows the localized network error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'michat-update-download-network-'))
    const closed = await closedLoopbackUrl()
    const { server, url, requests } = await startFeed(
      'installer-network',
      `${closed}michat-2.2.5-setup.exe`
    )
    writeUpdateConfig(url)
    const launched = await launchApp(directory)
    try {
      await completeOnboarding(launched.page)
      await openAbout(launched.page)
      await launched.page.waitForTimeout(6_500)
      requests.length = 0
      await checkForUpdates(launched.page)
      expect(requests).toContain('/latest.yml')
      await expect(
        launched.page.getByText(/new version 2\.2\.5 available|phát hiện phiên bản mới 2\.2\.5/i)
      ).toBeVisible({ timeout: 30_000 })
      await launched.page.getByRole('button', { name: /download update|tải bản cập nhật/i }).click()
      await expect(
        launched.page.getByText(
          /couldn't reach the update server\. check your network and try again|không thể kết nối máy chủ cập nhật\. kiểm tra mạng rồi thử lại/i
        )
      ).toBeVisible({ timeout: 30_000 })
      const state = await updateState(launched.page)
      expect(state.status).toBe('error')
      expect(state.errorKind).toBe('network')
      expect(launched.dialogs).toEqual([])
      expect(launched.errors).toEqual([])
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-03-download-network-error.png')
      })
    } finally {
      await launched.app.close().catch(() => undefined)
      await closeServer(server)
      restoreUpdateConfig()
      removeTempDir(directory)
    }
  })

  test('AC-04 — startup failure is silent and restart clears a manual error', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'michat-update-silent-'))
    const { server, url, requests } = await startFeed('feed-404')
    writeUpdateConfig(url)
    let launched = await launchApp(directory)
    try {
      await attachCollector(launched.page)
      await completeOnboarding(launched.page)
      await launched.page.waitForTimeout(6_500)
      await launched.page.waitForTimeout(200)
      const startupStderr = launched.stderr.join('')
      expect(startupStderr).toMatch(/Silent update check failed:/)
      expect(startupStderr).not.toMatch(
        /_gh_sess|set-cookie|content-security-policy|headers:|releases\.atom/i
      )
      await expect.poll(() => requests.length, { timeout: 5_000 }).toBeGreaterThan(0)
      await openAbout(launched.page)
      expect(await updateState(launched.page)).toMatchObject({ status: 'idle' })
      expect(await collector(launched.page)).toEqual([])
      expect(launched.errors).toEqual([])
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-04-silent-startup.png')
      })

      await checkForUpdates(launched.page)
      await expect(
        launched.page.getByText(
          /couldn't check for updates because the release feed is unavailable|không thể kiểm tra cập nhật vì nguồn phát hành không truy cập được/i
        )
      ).toBeVisible({ timeout: 30_000 })

      await launched.app.close().catch(() => undefined)
      const requestsBeforeRestart = requests.length
      launched = await launchApp(directory)
      await attachCollector(launched.page)
      await launched.page.waitForTimeout(6_500)
      await launched.page.waitForTimeout(200)
      await expect
        .poll(() => requests.length, { timeout: 5_000 })
        .toBeGreaterThan(requestsBeforeRestart)
      await openAbout(launched.page)
      expect(await updateState(launched.page)).toMatchObject({ status: 'idle' })
      expect(await collector(launched.page)).toEqual([])
      expect(launched.errors).toEqual([])
      expect(launched.stderr.join('')).not.toMatch(
        /_gh_sess|set-cookie|content-security-policy|headers:|releases\.atom/i
      )
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-04-restart-reset.png')
      })
      await launched.page.screenshot({
        path: join(EVIDENCE_DIR, 'ac-07-final-state.png')
      })
    } finally {
      await launched.app.close().catch(() => undefined)
      await closeServer(server)
      restoreUpdateConfig()
      removeTempDir(directory)
    }
  })
})
