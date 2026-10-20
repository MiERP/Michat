import { existsSync, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfficeCliService } from '../../src/main/services/officecli/OfficeCliService'
import { pipePaths } from '../../src/main/services/officecli/residentClient'
import { resolveOfficeCliBinary } from '../../src/main/services/officecli/resolveBinary'

const binary = resolveOfficeCliBinary()
const hasBinary = binary !== null && existsSync(binary)

describe('officecli binary resolution', () => {
  it('returns a stable, deterministic pipe pair for the same path', () => {
    const file = join(os.tmpdir(), 'some', 'Doc.DOCX')
    const [mainA, pingA] = pipePaths(file)
    const [mainB, pingB] = pipePaths(file)
    expect(mainA).toBe(mainB)
    expect(pingA).toBe(pingB)
    expect(pingA).toBe(`${mainA}-ping`)
    expect(mainA).toContain('officecli-')
  })

  it('hashes case-insensitively on Windows and macOS', () => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return
    const [a] = pipePaths(join(os.tmpdir(), 'Case.docx'))
    const [b] = pipePaths(join(os.tmpdir(), 'case.docx'))
    expect(a).toBe(b)
  })
})

describe.skipIf(!hasBinary)('OfficeCliService integration', () => {
  let workDir: string
  let service: OfficeCliService

  // Đây là integration test gọi binary native (spawn tiến trình con), chậm hơn
  // hẳn test thường và dễ vượt timeout 5s khi chạy song song cùng nhiều suite.
  const OFFICECLI_TEST_TIMEOUT = 30000

  beforeAll(async () => {
    workDir = mkdtempSync(join(os.tmpdir(), 'michat-officecli-test-'))
    service = new OfficeCliService()
    const status = await service.initialize()
    expect(status.available).toBe(true)
  })

  afterAll(async () => {
    await service?.closeAll()
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  it(
    'creates a Word document, writes content and reads the outline back',
    async () => {
      const file = join(workDir, 'report.docx')

      const created = await service.create(file)
      expect(created.success).toBe(true)

      const added = await service.batch(file, [
        {
          command: 'add',
          parent: '/body',
          type: 'paragraph',
          props: { text: 'Executive Summary', style: 'Heading1' }
        },
        { command: 'add', parent: '/body', type: 'paragraph', props: { text: 'Revenue grew 25%.' } }
      ])
      expect(added.success).toBe(true)

      const outline = await service.viewOutline(file)
      expect(outline.success).toBe(true)
      expect(outline.data?.paragraphs).toBe(2)
      expect(outline.data?.headings?.[0]?.text).toBe('Executive Summary')

      const text = await service.viewText(file)
      expect(text.success).toBe(true)
      expect(JSON.stringify(text.data)).toContain('Revenue grew 25%')

      const validation = await service.validate(file)
      expect(validation.success).toBe(true)
    },
    OFFICECLI_TEST_TIMEOUT
  )

  it(
    'evaluates Excel formulas on write',
    async () => {
      const file = join(workDir, 'book.xlsx')
      await service.create(file)

      await service.batch(file, [
        { command: 'set', path: '/Sheet1/A1', props: { value: '10' } },
        { command: 'set', path: '/Sheet1/A2', props: { value: '32' } },
        { command: 'set', path: '/Sheet1/A3', props: { value: '=SUM(A1:A2)' } }
      ])

      const cell = (await service.run(file, { command: 'get', path: '/Sheet1/A3' })) as {
        data?: { results?: { text?: string }[] }
      }
      expect(cell.success).toBe(true)
      expect(cell.data?.results?.[0]?.text).toBe('42')
    },
    OFFICECLI_TEST_TIMEOUT
  )

  it(
    'merges a template with JSON data',
    async () => {
      const template = join(workDir, 'invoice-template.docx')
      const output = join(workDir, 'invoice-001.docx')

      await service.create(template)
      await service.batch(template, [
        {
          command: 'add',
          parent: '/body',
          type: 'paragraph',
          props: { text: 'Hello {{client}}, total {{total}}' }
        }
      ])

      const merged = await service.merge(template, output, { client: 'Acme', total: '5200' })
      expect(merged.success).toBe(true)
      expect(existsSync(output)).toBe(true)

      const text = await service.viewText(output)
      const serialised = JSON.stringify(text.data)
      expect(serialised).toContain('Acme')
      expect(serialised).toContain('5200')
      expect(serialised).not.toContain('{{client}}')
    },
    OFFICECLI_TEST_TIMEOUT
  )

  it(
    'reports issues for a document',
    async () => {
      const file = join(workDir, 'empty.docx')
      await service.create(file)

      const issues = await service.viewIssues(file)
      expect(issues.success).toBe(true)
      expect(typeof issues.data?.count).toBe('number')
    },
    OFFICECLI_TEST_TIMEOUT
  )

  it('exposes a status snapshot with the probed version', () => {
    const status = service.status
    expect(status.version).toMatch(/^\d+\.\d+/)
    expect(status.binaryPath).toBe(binary)
  })
})

describe.skipIf(hasBinary)('OfficeCliService without a binary', () => {
  it('degrades gracefully instead of throwing', async () => {
    const service = new OfficeCliService()
    const status = await service.initialize()
    expect(status.available).toBe(false)
    expect(status.binaryPath).toBeNull()
  })
})
