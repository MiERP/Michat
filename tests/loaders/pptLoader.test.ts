import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfficeCliService } from '../../src/main/services/officecli/OfficeCliService'
import { resolveOfficeCliBinary } from '../../src/main/services/officecli/resolveBinary'
import { PptLoader } from '../../src/main/services/loaders/PptLoader'

const binary = resolveOfficeCliBinary()
const hasBinary = binary !== null && existsSync(binary)

describe('PptLoader', () => {
  it('claims .pptx and .ppt but rejects .docx', () => {
    const loader = new PptLoader()
    expect(loader.canLoad('deck.pptx')).toBe(true)
    expect(loader.canLoad('deck.ppt')).toBe(true)
    expect(loader.canLoad('report.docx')).toBe(false)
  })

  it('gives an actionable error for legacy .ppt instead of a parser crash', async () => {
    const loader = new PptLoader()
    await expect(loader.loadFromPath('/tmp/legacy.ppt')).rejects.toThrow(/Save the file as \.pptx/i)
  })
})

describe.skipIf(!hasBinary)('PptLoader with a real .pptx', () => {
  let workDir: string
  let service: OfficeCliService
  let deckPath: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(os.tmpdir(), 'michat-pptloader-'))
    deckPath = join(workDir, 'deck.pptx')

    service = new OfficeCliService()
    await service.initialize()
    await service.create(deckPath)
    await service.batch(
      deckPath,
      [
        {
          command: 'add',
          parent: '/',
          type: 'slide',
          props: { title: 'Quarterly Review', text: 'Revenue up 25%\nChurn down 3 points' }
        },
        {
          command: 'add',
          parent: '/',
          type: 'slide',
          props: { title: 'Next Steps', text: 'Hire two engineers' }
        }
      ],
      { bestEffort: true }
    )
    await service.save(deckPath)
  })

  afterAll(async () => {
    await service?.closeAll()
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  it('extracts slide text without throwing', async () => {
    const loader = new PptLoader()
    const result = await loader.loadFromPath(deckPath)

    expect(result.content).toContain('Quarterly Review')
    expect(result.content).toContain('Revenue up 25%')
    expect(result.content).toContain('Next Steps')
    expect(result.title).toBe('Quarterly Review')
    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  })

  it('builds page structure with one entry per slide', async () => {
    const loader = new PptLoader()
    const result = await loader.loadFromPath(deckPath)

    expect(result.structure?.type).toBe('pages')
    const pages = result.structure?.pages ?? []
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[0].content).toContain('Quarterly Review')
    expect(pages[1].content).toContain('Next Steps')
  })

  it('points page offsets at the matching slice of content', async () => {
    const loader = new PptLoader()
    const result = await loader.loadFromPath(deckPath)

    for (const page of result.structure?.pages ?? []) {
      const slice = result.content.slice(page.startOffset, page.endOffset)
      expect(slice).toBe(page.content)
      expect(page.endOffset).toBeGreaterThan(page.startOffset)
    }
  })

  it('works from a buffer as well as a path', async () => {
    const { readFileSync } = await import('fs')
    const loader = new PptLoader()
    const result = await loader.loadFromBuffer(readFileSync(deckPath))

    expect(result.content).toContain('Quarterly Review')
    expect(result.structure?.type).toBe('pages')
  })

  it('reports slide count in metadata', async () => {
    const loader = new PptLoader()
    const result = await loader.loadFromPath(deckPath)
    expect(result.metadata?.slideCount).toBeGreaterThanOrEqual(2)
  })

  it('rejects a file that is not a real pptx', async () => {
    const broken = join(workDir, 'broken.pptx')
    writeFileSync(broken, 'definitely not a presentation')
    const loader = new PptLoader()
    await expect(loader.loadFromPath(broken)).rejects.toThrow(/Failed to parse PPT/)
  })
})
