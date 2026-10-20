import { existsSync, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { officeCliService } from '../../src/main/services/officecli/OfficeCliService'
import { createOfficeAgentTools } from '../../src/main/services/officecli/agentTools'
import {
  buildOfficeAgentPrompt,
  buildOfficeAgentUserPrompt
} from '../../src/main/services/officecli/officeAgentPrompt'
import { OFFICE_SKILLS, resolveOfficeSkill } from '../../src/main/services/officecli/officeSkills'
import { resolveOfficeCliBinary } from '../../src/main/services/officecli/resolveBinary'

const binary = resolveOfficeCliBinary()
const hasBinary = binary !== null && existsSync(binary)

type Executable = { execute: (input: unknown, options?: unknown) => Promise<unknown> }

describe('office agent prompt', () => {
  it('substitutes file, kind and title placeholders', () => {
    const prompt = buildOfficeAgentPrompt(
      'Doc {{TITLE}} ({{KIND}}) at {{FILE}}. Only touch {{FILE}}.',
      { title: 'Báo cáo Q3', kind: 'pptx', file: 'C:\\out\\report.pptx' }
    )
    expect(prompt).toBe(
      'Doc Báo cáo Q3 (pptx) at C:\\out\\report.pptx. Only touch C:\\out\\report.pptx.'
    )
  })

  it('replaces every occurrence of a placeholder', () => {
    const prompt = buildOfficeAgentPrompt('{{FILE}} {{FILE}} {{KIND}}', {
      file: '/tmp/a.docx',
      kind: 'docx',
      title: 't'
    })
    expect(prompt).toBe('/tmp/a.docx /tmp/a.docx docx')
  })
})

describe('office agent user prompt', () => {
  it('includes skill, instruction and source content when creating', () => {
    const prompt = buildOfficeAgentUserPrompt({
      instruction: 'Viết báo cáo',
      skill: 'officecli-docx',
      attempt: 1,
      sourceContent: 'Nội dung nguồn'
    })
    expect(prompt).toContain('load_skill("officecli-docx")')
    expect(prompt).toContain('Viết báo cáo')
    expect(prompt).toContain('Nội dung nguồn')
    expect(prompt).not.toContain('CHỈNH SỬA')
    expect(prompt).not.toContain('TRỐNG')
  })

  it('adds the empty-document nudge on the retry attempt', () => {
    const prompt = buildOfficeAgentUserPrompt({
      skill: 'officecli-pptx',
      attempt: 2,
      sourceContent: 'x'
    })
    expect(prompt).toContain('TRỐNG')
    expect(prompt).toContain('load_skill("officecli-pptx")')
  })

  it('switches to edit wording and uses reference wording in edit mode', () => {
    const prompt = buildOfficeAgentUserPrompt({
      instruction: 'Gộp sheet',
      skill: 'officecli-xlsx',
      attempt: 1,
      sourceContent: 'nguồn',
      isEdit: true
    })
    expect(prompt).toContain('CHỈNH SỬA')
    expect(prompt).toContain('GIỮ LẠI')
    expect(prompt).not.toContain('không bịa thêm')
    expect(prompt).toContain('Nguồn tham khảo thêm')
  })
})

describe('office skill resolution', () => {
  it('falls back to the kind-specific skill for auto/undefined', () => {
    expect(resolveOfficeSkill('docx')).toBe('officecli-docx')
    expect(resolveOfficeSkill('xlsx', 'auto')).toBe('officecli-xlsx')
    expect(resolveOfficeSkill('pptx', 'auto')).toBe('officecli-pptx')
  })

  it('honours an explicit skill', () => {
    expect(resolveOfficeSkill('pptx', 'morph-ppt')).toBe('morph-ppt')
    expect(resolveOfficeSkill('docx', 'officecli-academic-paper')).toBe('officecli-academic-paper')
  })

  it('exposes unique skill names that include auto', () => {
    expect(OFFICE_SKILLS).toContain('auto')
    expect(new Set(OFFICE_SKILLS).size).toBe(OFFICE_SKILLS.length)
  })
})

describe.skipIf(!hasBinary)('office agent tools bound to one file', () => {
  let workDir: string
  let allowed: string
  let other: string

  beforeAll(async () => {
    workDir = mkdtempSync(join(os.tmpdir(), 'michat-officeagent-'))
    allowed = join(workDir, 'target.docx')
    other = join(workDir, 'other.docx')
    await officeCliService.initialize()
    await officeCliService.create(allowed)
    await officeCliService.create(other)
  })

  afterAll(async () => {
    await officeCliService?.closeAll()
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  it('refuses to operate on any file other than the bound one', async () => {
    const tools = createOfficeAgentTools({ allowedFile: allowed }) as Record<string, Executable>
    const result = await tools.officecli.execute({ file: other, command: 'validate' })
    expect(String(result)).toContain('restricted')
    expect(String(result)).toContain('"success":false')
  })

  it('operates on the bound file when no file argument is passed', async () => {
    const tools = createOfficeAgentTools({ allowedFile: allowed }) as Record<string, Executable>
    const result = await tools.officecli.execute({
      command: 'add',
      parent: '/body',
      type: 'paragraph',
      props: { text: 'Bound write', style: 'Heading1' }
    })
    expect(String(result)).toContain('"success":true')

    const read = await tools.officecli.execute({ command: 'view', mode: 'outline' })
    expect(String(read)).toContain('Bound write')
  })
})

describe.skipIf(hasBinary)('office agent tools without the engine', () => {
  it('returns no tools at all', () => {
    expect(createOfficeAgentTools({ allowedFile: '/tmp/x.docx' })).toBeUndefined()
  })
})
