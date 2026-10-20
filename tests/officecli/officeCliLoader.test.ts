import { existsSync, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OfficeCliService } from '../../src/main/services/officecli/OfficeCliService'
import { resolveOfficeCliBinary } from '../../src/main/services/officecli/resolveBinary'
import { OfficeCliLoader } from '../../src/main/services/loaders/OfficeCliLoader'

const binary = resolveOfficeCliBinary()
const hasBinary = binary !== null && existsSync(binary)

describe('OfficeCliLoader without a ready engine', () => {
  it('registers only docx and pptx so Excel keeps its table-oriented loader', () => {
    const loader = new OfficeCliLoader(new OfficeCliService())
    expect(loader.supportedExtensions).toEqual(['docx', 'pptx'])
    expect(loader.canLoad('report.docx')).toBe(true)
    expect(loader.canLoad('deck.pptx')).toBe(true)
    expect(loader.canLoad('book.xlsx')).toBe(false)
    expect(loader.canLoad('notes.md')).toBe(false)
  })

  it('throws for an extension it has no fallback for', async () => {
    const loader = new OfficeCliLoader(new OfficeCliService())
    await expect(loader.loadFromPath('nope.txt')).rejects.toThrow()
  })
})

describe.skipIf(!hasBinary)('OfficeCliLoader with a ready engine', () => {
  let workDir: string
  let service: OfficeCliService
  let loader: OfficeCliLoader

  beforeAll(async () => {
    workDir = mkdtempSync(join(os.tmpdir(), 'michat-officeloader-'))
    service = new OfficeCliService()
    await service.initialize()
    loader = new OfficeCliLoader(service)
  })

  afterAll(async () => {
    await service?.closeAll()
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  it('extracts Word content with heading structure', async () => {
    const file = join(workDir, 'loader.docx')
    await service.create(file)
    await service.batch(file, [
      {
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: 'Findings', style: 'Heading1' }
      },
      {
        command: 'add',
        parent: '/body',
        type: 'paragraph',
        props: { text: 'Churn fell by 3 points.' }
      }
    ])
    await service.save(file)

    const result = await loader.loadFromPath(file)
    expect(result.content).toContain('Churn fell by 3 points.')
    expect(result.content).toContain('Findings')
    expect(result.title).toBe('Findings')
    expect(result.structure?.type).toBe('sections')
    expect(result.metadata?.source).toBe('officecli')
  })

  it('extracts PowerPoint content as page structure', async () => {
    const file = join(workDir, 'loader.pptx')
    await service.create(file)
    await service.batch(file, [
      {
        command: 'add',
        parent: '/',
        type: 'slide',
        props: { title: 'Agenda', text: 'First\nSecond' }
      },
      { command: 'add', parent: '/', type: 'slide', props: { title: 'Wrap Up' } }
    ])
    await service.save(file)

    const result = await loader.loadFromPath(file)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.structure?.type).toBe('pages')
    expect(result.structure?.pages?.length).toBe(2)
    expect(result.title).toBe('Agenda')
  })

  it('falls back to the legacy loader when the file is not a valid document', async () => {
    const file = join(workDir, 'broken.docx')
    await import('fs').then((fs) => fs.writeFileSync(file, 'not a real docx'))
    await expect(loader.loadFromPath(file)).rejects.toThrow()
  })
})
