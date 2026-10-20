import { existsSync, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfficeCliService } from '../../src/main/services/officecli/OfficeCliService'
import { docxItems, pptxItems, xlsxItems } from '../../src/main/services/officecli/markdownToOffice'
import { resolveOfficeCliBinary } from '../../src/main/services/officecli/resolveBinary'

const binary = resolveOfficeCliBinary()
const hasBinary = binary !== null && existsSync(binary)

const SAMPLE = `# Quarterly Report

Revenue grew 25% year over year, driven by new markets.

## Highlights

- Launched two products
- Reduced churn by 3 points

## Metrics

| Region | Revenue |
| --- | --- |
| EMEA | 1200 |
| APAC | 900 |

> Reviewed and approved by finance.
`

describe('markdown to office conversion', () => {
  it('maps headings, lists, tables and quotes for Word', () => {
    const items = docxItems(SAMPLE, { title: 'Quarterly Report' })
    const styles = items.map((i) => (i.props as Record<string, unknown> | undefined)?.style)
    expect(styles).toContain('Title')
    expect(styles).toContain('Heading1')
    expect(styles).toContain('Heading2')
    expect(styles).toContain('ListBullet')
    expect(styles).toContain('Quote')

    const table = items.find((i) => i.type === 'table')
    expect(table).toBeDefined()
    expect(String((table?.props as Record<string, unknown>)?.data)).toBe(
      'Region,Revenue;EMEA,1200;APAC,900'
    )
  })

  it('creates one slide per heading for PowerPoint', () => {
    const items = pptxItems(SAMPLE)
    const titles = items.map((i) => String((i.props as Record<string, unknown>).title))
    expect(titles).toContain('Quarterly Report')
    expect(titles).toContain('Highlights')
    expect(titles).toContain('Metrics')

    const highlights = items.find(
      (i) => String((i.props as Record<string, unknown>).title) === 'Highlights'
    )
    expect(String((highlights?.props as Record<string, unknown>).text)).toContain(
      'Launched two products'
    )
  })

  it('creates one sheet per table for Excel', () => {
    const items = xlsxItems(SAMPLE)
    expect(items.some((i) => i.type === 'sheet')).toBe(true)
    const cellSet = items.filter((i) => i.command === 'set')
    expect(cellSet.length).toBeGreaterThan(0)
    expect(cellSet.some((i) => String(i.path).endsWith('/A1'))).toBe(true)
  })

  it('falls back to a single sheet of text when there are no tables', () => {
    const items = xlsxItems('Just some plain text\nsecond line')
    expect(items.filter((i) => i.type === 'sheet')).toHaveLength(1)
    expect(items.filter((i) => i.command === 'set').length).toBeGreaterThanOrEqual(2)
  })
})

describe.skipIf(!hasBinary)('markdown to office end-to-end', () => {
  let workDir: string
  let service: OfficeCliService

  beforeAll(async () => {
    workDir = mkdtempSync(join(os.tmpdir(), 'michat-md-office-'))
    service = new OfficeCliService()
    await service.initialize()
  })

  afterAll(async () => {
    await service?.closeAll()
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  it('generates a Word document that reads back with the note content', async () => {
    const file = join(workDir, 'report.docx')
    await service.create(file)
    const items = docxItems(SAMPLE, { title: 'Quarterly Report' })
    const applied = await service.batch(file, items, { bestEffort: true })
    expect(applied.success).toBe(true)

    const outline = await service.viewOutline(file)
    expect(outline.data?.headings?.map((h) => h.text)).toContain('Highlights')

    const text = await service.viewText(file)
    const serialised = JSON.stringify(text.data)
    expect(serialised).toContain('Revenue grew 25%')
    expect(serialised).toContain('Launched two products')
  })

  it('generates a PowerPoint deck with a slide per heading', async () => {
    const file = join(workDir, 'deck.pptx')
    await service.create(file)
    const items = pptxItems(SAMPLE)
    const applied = await service.batch(file, items, { bestEffort: true })
    expect(applied.success).toBe(true)

    const outline = await service.viewOutline(file)
    expect(outline.success).toBe(true)
    expect(outline.data?.totalSlides ?? 0).toBeGreaterThan(0)
    expect(outline.data?.slides?.map((s) => s.title)).toContain('Highlights')
  })

  it('generates an Excel workbook from a markdown table', async () => {
    const file = join(workDir, 'metrics.xlsx')
    await service.create(file)
    const items = xlsxItems(SAMPLE)
    const applied = await service.batch(file, items, { bestEffort: true })
    expect(applied.success).toBe(true)

    const text = await service.viewText(file)
    expect(text.success).toBe(true)
  })
})
