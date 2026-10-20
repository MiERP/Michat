import { existsSync, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { officeCliService } from '../../src/main/services/officecli/OfficeCliService'
import { createOfficeAgentTools } from '../../src/main/services/officecli/agentTools'
import { resolveOfficeCliBinary } from '../../src/main/services/officecli/resolveBinary'

const binary = resolveOfficeCliBinary()
const hasBinary = binary !== null && existsSync(binary)

/** The AI SDK hands `execute` an options bag; tests only need the input. */
type Executable = { execute: (input: unknown, options?: unknown) => Promise<unknown> }

describe.skipIf(!hasBinary)('office agent tools', () => {
  let workDir: string
  let file: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(os.tmpdir(), 'michat-agenttools-'))
    file = join(workDir, 'agent.docx')
    await officeCliService.initialize()
    await officeCliService.create(file)
  })

  afterAll(async () => {
    await officeCliService?.closeAll()
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  it('exposes exactly the document tool and the skill loader', () => {
    const tools = createOfficeAgentTools()
    expect(tools).toBeDefined()
    expect(Object.keys(tools ?? {}).sort()).toEqual(['load_skill', 'officecli'])
  })

  it('adds and reads back a paragraph through the officecli tool', async () => {
    const tools = createOfficeAgentTools() as Record<string, Executable>

    const added = await tools.officecli.execute({
      file,
      command: 'add',
      parent: '/body',
      type: 'paragraph',
      props: { text: 'Written by the agent', style: 'Heading1' }
    })
    expect(String(added)).toContain('"success":true')

    const read = await tools.officecli.execute({
      file,
      command: 'view',
      mode: 'outline'
    })
    expect(String(read)).toContain('Written by the agent')
  })

  it('lists the embedded skills through load_skill', async () => {
    const tools = createOfficeAgentTools() as Record<string, Executable>
    const catalogue = await tools.load_skill.execute({})
    expect(String(catalogue).toLowerCase()).toContain('officecli')
  })

  it('reports tool results within the context budget', async () => {
    const tools = createOfficeAgentTools() as Record<string, Executable>
    const result = await tools.officecli.execute({ file, command: 'validate' })
    expect(String(result).length).toBeLessThan(9000)
  })
})

describe.skipIf(hasBinary)('office agent tools without the engine', () => {
  it('returns no tools so chat stays a plain RAG conversation', () => {
    // The singleton is uninitialised in this branch only when the binary is absent.
    expect(createOfficeAgentTools()).toBeUndefined()
  })
})
