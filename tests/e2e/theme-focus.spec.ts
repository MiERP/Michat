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
  join(process.cwd(), '.opencode', 'evidence', 'theme-focus-local')

mkdirSync(EVIDENCE_DIR, { recursive: true })

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: false })
}

async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication
  page: Page
  errors: string[]
  stderr: string[]
}> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, MICHAT_E2E_OFFSCREEN: '1' } as Record<string, string>
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  const stderr: string[] = []
  app.process().stderr?.on('data', (chunk) => stderr.push(String(chunk)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')

  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  // Windows clamps very negative coordinates; require every pixel to be left
  // of the virtual desktop instead of an exact constant.
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(0)
  expect(bounds.y).toBeLessThanOrEqual(0)

  return { app, page, errors, stderr }
}

function mainProcessErrors(stderr: string[]): string[] {
  return stderr.filter((line) => /Unhandled|Uncaught|SQLITE_|Error:/.test(line))
}

async function closeApp(app: ElectronApplication | null): Promise<void> {
  if (!app) return
  try {
    await app.close()
  } catch {
    // The test may already have closed the app in a failure path.
  }
}

function removeTempDir(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  } catch (error) {
    // Chromium can hold DIPS/Cache files for a moment after close; a leftover
    // temp profile must not fail an otherwise green verification run.
    if ((error as NodeJS.ErrnoException).code !== 'EBUSY') {
      console.warn(`[e2e] could not remove temp profile ${directory}:`, error)
    }
  }
}

async function completeOnboarding(page: Page): Promise<void> {
  await page.getByRole('button', { name: /get started|bắt đầu/i }).click()
  await expect(page.locator('[data-testid="create-notebook"]')).toBeVisible()
}

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

async function readChatState(page: Page): Promise<{
  notebookId: string | null
  sessionId: string | null
  messages: Array<{ id: string; role: string; content: string; feedback: string | null }>
}> {
  return page.evaluate(async () => {
    const notebookId = location.hash.split('/').filter(Boolean).pop() ?? null
    if (!notebookId) return { notebookId: null, sessionId: null, messages: [] }
    const session = await window.api.getActiveSession(notebookId)
    if (!session) return { notebookId, sessionId: null, messages: [] }
    const messages = await window.api.getMessages(session.id)
    return {
      notebookId,
      sessionId: session.id,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        feedback: message.feedback ?? null
      }))
    }
  })
}

async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
}

test.describe.configure({ mode: 'serial' })

test('AC-01/AC-02 — light default, missing theme, saved dark preference', async () => {
  test.setTimeout(180_000)
  const freshDir = mkdtempSync(join(tmpdir(), 'michat-theme-fresh-'))
  const missingThemeDir = mkdtempSync(join(tmpdir(), 'michat-theme-missing-'))
  let app: ElectronApplication | null = null

  try {
    const launched = await launchApp(freshDir)
    app = launched.app
    const page = launched.page

    await expect(page.getByRole('button', { name: /get started|bắt đầu/i })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      false
    )
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(240, 243, 240)'
    )
    expect(await page.evaluate(() => window.api.settings.get('theme'))).toBe('light')
    expect(
      (
        await launched.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getBackgroundColor()
        )
      ).toLowerCase()
    ).toBe('#fafafa')
    await screenshot(page, 'ac-01-fresh-light-onboarding.png')

    await completeOnboarding(page)
    await page.locator('[data-testid="create-notebook"]').click()
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible()

    await page.evaluate(() => window.api.settings.set('theme', 'dark'))
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)
    await screenshot(page, 'ac-02-existing-dark-preserved.png')

    const configPath = join(freshDir, 'michat-config.json')
    const savedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as {
      settings?: { theme?: string }
    }
    expect(savedConfig.settings?.theme).toBe('dark')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(17, 24, 32)'
    )
    expect(launched.errors).toEqual([])
    expect(mainProcessErrors(launched.stderr)).toEqual([])

    await closeApp(launched.app)
    app = null

    const relaunched = await launchApp(freshDir)
    app = relaunched.app
    await expect
      .poll(() => relaunched.page.evaluate(() => window.api.settings.get('theme')))
      .toBe('dark')
    expect(
      await relaunched.page.evaluate(() => document.documentElement.classList.contains('dark'))
    ).toBe(true)
    const reloadedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as {
      settings?: { theme?: string }
    }
    expect(reloadedConfig.settings?.theme).toBe('dark')
    expect(relaunched.errors).toEqual([])
    expect(mainProcessErrors(relaunched.stderr)).toEqual([])

    await closeApp(relaunched.app)
    app = null

    const configPathMissingTheme = join(missingThemeDir, 'michat-config.json')
    writeFileSync(
      configPathMissingTheme,
      JSON.stringify({ settings: { hasCompletedOnboarding: true }, settingsVersion: 2 }),
      'utf8'
    )
    const missingTheme = await launchApp(missingThemeDir)
    app = missingTheme.app
    await expect(missingTheme.page.locator('[data-testid="create-notebook"]')).toBeVisible()
    expect(
      await missingTheme.page.evaluate(() => document.documentElement.classList.contains('dark'))
    ).toBe(false)
    expect(await missingTheme.page.evaluate(() => window.api.settings.get('theme'))).toBe('light')
    await screenshot(missingTheme.page, 'ac-01b-missing-theme-profile.png')
    expect(missingTheme.errors).toEqual([])
    expect(mainProcessErrors(missingTheme.stderr)).toEqual([])
  } finally {
    await closeApp(app)
    removeTempDir(freshDir)
    removeTempDir(missingThemeDir)
  }
})

test('AC-03..AC-07/AC-09..AC-11 — chat focus, guards, actions, and version', async () => {
  test.setTimeout(240_000)
  const userDataDir = mkdtempSync(join(tmpdir(), 'michat-focus-'))
  const { server, baseUrl } = await startFakeApi()
  let app: ElectronApplication | null = null

  try {
    const launched = await launchApp(userDataDir)
    app = launched.app
    const page = launched.page

    await completeOnboarding(page)
    await page.evaluate(() => window.api.api.saveConfig({ baseUrl: '' }))
    await page.locator('[data-testid="create-notebook"]').click()

    const chatInput = page.locator('[data-testid="chat-input"]')
    await expect(chatInput).toBeVisible()
    await expect(chatInput).toBeDisabled()
    expect(await activeTestId(page)).not.toBe('chat-input')
    await screenshot(page, 'ac-11-disabled-composer.png')

    await page.evaluate((url) => window.api.api.saveConfig({ baseUrl: url }), baseUrl)
    await expect(chatInput).toBeEnabled({ timeout: 15_000 })
    await expect.poll(() => activeTestId(page)).toBe('chat-input')
    await screenshot(page, 'ac-03-chat-input-focused.png')

    await page.evaluate(() => {
      const state = window as unknown as { __michatStreamEvents: number }
      state.__michatStreamEvents = 0
      window.api.onMessageCreated(() => {
        state.__michatStreamEvents += 1
      })
      window.api.onMessageChunk(() => {
        state.__michatStreamEvents += 1
      })
    })

    await chatInput.fill('Tài liệu này nói về điều gì?')
    await chatInput.press('Enter')
    await expect(page.getByText(/chưa có nội dung|no indexed content/i).first()).toBeVisible({
      timeout: 20_000
    })
    expect(
      await page.evaluate(
        () => (window as unknown as { __michatStreamEvents: number }).__michatStreamEvents
      )
    ).toBe(0)
    await expect(chatInput).toBeEnabled()
    await expect.poll(() => activeTestId(page)).toBe('chat-input')
    await screenshot(page, 'ac-04-focus-after-reply.png')

    const afterReply = await readChatState(page)
    expect(afterReply.sessionId).toBeTruthy()
    expect(afterReply.messages).toHaveLength(2)
    expect(afterReply.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(afterReply.messages.filter((message) => message.role === 'assistant')).toHaveLength(1)
    const messageIds = afterReply.messages.map((message) => message.id)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText(/chưa có nội dung|no indexed content/i).first()).toBeVisible()
    const afterReload = await readChatState(page)
    expect(afterReload.messages.map((message) => message.id).sort()).toEqual(messageIds.sort())

    // AC-05: title edit keeps focus and never yields to the composer, even when
    // an explicit stream-complete transition arrives.
    await page.locator('[data-testid="notebook-title-button"]').click()
    const titleInput = page.locator('[data-testid="notebook-title-input"]')
    await expect(titleInput).toBeFocused()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(titleInput).toBeFocused()

    const streamMessageId = `sim_stream_${Date.now()}`
    await launched.app.evaluate(
      ({ BrowserWindow }, ids) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents
        contents.send('message-created', {
          messageId: ids.messageId,
          sessionId: ids.sessionId,
          notebookId: ids.notebookId
        })
        setTimeout(() => {
          contents.send('message-chunk', {
            messageId: ids.messageId,
            type: 'text-delta',
            content: 'simulated streamed reply'
          })
          contents.send('message-chunk', { messageId: ids.messageId, type: 'finish' })
        }, 120)
      },
      {
        messageId: streamMessageId,
        sessionId: afterReload.sessionId,
        notebookId: afterReload.notebookId
      }
    )
    await page.waitForTimeout(600)
    await expect(titleInput).toBeFocused()
    await screenshot(page, 'ac-05-no-steal-title-edit.png')
    await titleInput.press('Escape')
    await expect(titleInput).toHaveCount(0)

    // Drop the simulated, non-persisted stream message before continuing.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText(/chưa có nội dung|no indexed content/i).first()).toBeVisible()

    // AC-05: Settings dialog blocks the composer; AC-07 reads About.
    await page.locator('[data-testid="open-settings"]').click()
    const settingsDialog = page.getByRole('dialog')
    await expect(settingsDialog).toBeVisible()
    expect(await activeTestId(page)).not.toBe('chat-input')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect(await activeTestId(page)).not.toBe('chat-input')
    await screenshot(page, 'ac-05-no-steal-settings-dialog.png')

    await settingsDialog
      .getByRole('button', { name: /about|giới thiệu/i })
      .first()
      .click()
    await expect(page.getByText('v2.2.3')).toBeVisible()
    await screenshot(page, 'ac-07-about-version.png')

    await page.keyboard.press('Escape')
    await expect(settingsDialog).toBeHidden()
    await expect.poll(() => activeTestId(page), { timeout: 5_000 }).toBe('chat-input')

    // AC-05: alert dialog blocks the composer.
    await page.getByText('Tài liệu này nói về điều gì?').first().hover()
    await page.locator('[data-testid="user-message-delete"]').click()
    const alertDialog = page.getByRole('alertdialog')
    await expect(alertDialog).toBeVisible()
    expect(await activeTestId(page)).not.toBe('chat-input')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect(await activeTestId(page)).not.toBe('chat-input')
    await screenshot(page, 'ac-05-no-steal-alert-dialog.png')
    await page.keyboard.press('Escape')
    await expect(alertDialog).toBeHidden()
    await expect.poll(() => activeTestId(page), { timeout: 5_000 }).toBe('chat-input')

    // AC-06: no redundant focus() call while already focused. A DOM focus
    // event would not fire for a redundant call, so spy on the method itself.
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement
      const state = window as unknown as { __michatFocusCalls: number }
      state.__michatFocusCalls = 0
      const originalFocus = target.focus.bind(target)
      target.focus = (options?: FocusOptions) => {
        state.__michatFocusCalls += 1
        originalFocus(options)
      }
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(150)
    expect(
      await page.evaluate(
        () => (window as unknown as { __michatFocusCalls: number }).__michatFocusCalls
      )
    ).toBe(0)

    // AC-06: window focus and panel click restore the composer.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(chatInput).toBeFocused()
    await page.waitForTimeout(150)
    await screenshot(page, 'ac-06-refocus-window.png')

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const messagesBox = await page.locator('[data-testid="chat-messages"]').boundingBox()
    expect(messagesBox).not.toBeNull()
    await page.locator('[data-testid="chat-messages"]').click({
      position: {
        x: Math.max(20, (messagesBox?.width ?? 400) - 80),
        y: Math.max(20, Math.min(80, (messagesBox?.height ?? 200) / 2))
      }
    })
    await expect(chatInput).toBeFocused()
    await page.waitForTimeout(300)
    await expect(chatInput).toBeFocused()
    await screenshot(page, 'ac-06-refocus-panel-click.png')

    // AC-06: an active text selection blocks automatic focus.
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="chat-messages"] .markdown-content')
      if (!target) throw new Error('No reply content to select')
      const range = document.createRange()
      range.selectNodeContents(target)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      ;(document.activeElement as HTMLElement | null)?.blur()
      window.dispatchEvent(new Event('focus'))
    })
    await page.waitForTimeout(150)
    expect(await activeTestId(page)).not.toBe('chat-input')
    await page.evaluate(() => window.getSelection()?.removeAllRanges())

    // AC-09: visible action row, feedback persistence, exact clipboard text.
    await page
      .getByText(/chưa có nội dung|no indexed content/i)
      .first()
      .hover()
    await screenshot(page, 'ac-09-message-actions.png')
    await page.locator('[data-testid="message-like"]').click()
    await expect(page.locator('[data-testid="message-like"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect
      .poll(async () => {
        const state = await readChatState(page)
        return state.messages.find((message) => message.role === 'assistant')?.feedback ?? null
      })
      .toBe('like')

    await page.evaluate(() => window.api.copyToClipboard('MiChat-2.2.3'))
    expect(await launched.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      'MiChat-2.2.3'
    )

    const assistantContent = (await readChatState(page)).messages.find(
      (message) => message.role === 'assistant'
    )?.content
    expect(assistantContent).toBeTruthy()
    await page
      .getByText(/chưa có nội dung|no indexed content/i)
      .first()
      .hover()
    await page.locator('[data-testid="assistant-message-copy"]').click()
    await expect
      .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(assistantContent)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText(/chưa có nội dung|no indexed content/i).first()).toBeVisible()
    await expect
      .poll(async () => {
        const state = await readChatState(page)
        return state.messages.find((message) => message.role === 'assistant')?.feedback ?? null
      })
      .toBe('like')
    await expect(page.locator('[data-testid="message-like"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    // AC-09: deleting the user message also removes its reply.
    await page.getByText('Tài liệu này nói về điều gì?').first().hover()
    await page.locator('[data-testid="user-message-delete"]').click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.locator('[data-testid="confirm-delete-message"]').click()
    await expect
      .poll(async () => (await readChatState(page)).messages.length, { timeout: 10_000 })
      .toBe(0)
    const afterDelete = await readChatState(page)
    expect(afterDelete.messages.map((message) => message.id)).not.toContain(messageIds[0])
    expect(afterDelete.messages.map((message) => message.id)).not.toContain(messageIds[1])

    await screenshot(page, 'ac-10-final-state.png')
    expect(launched.errors).toEqual([])
    expect(mainProcessErrors(launched.stderr)).toEqual([])
  } finally {
    await closeApp(app)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    removeTempDir(userDataDir)
  }
})
