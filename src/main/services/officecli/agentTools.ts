import { tool, type ToolSet } from 'ai'
import { resolve } from 'path'
import { z } from 'zod'
import Logger from '../../../shared/utils/logger'
import { officeCliService } from './OfficeCliService'

/**
 * Agent-facing tools for the bundled officecli engine.
 *
 * Deliberately mirrors officecli's own MCP server design: ONE document tool
 * plus a skill loader. A wide tool surface does not fit a small local model's
 * context, whereas a single well-documented tool plus on-demand skills does.
 *
 * Only verbs the resident pipe serves are exposed. Commands that must run as a
 * one-shot CLI process (create/merge/help) stay on the deterministic IPC path.
 */

const MAX_RESULT_CHARS = 8000

const RESIDENT_VERBS = [
  'view',
  'get',
  'query',
  'set',
  'add',
  'remove',
  'move',
  'swap',
  'refresh',
  'raw',
  'raw-set',
  'add-part',
  'validate',
  'save',
  'dump'
] as const

const OFFICECLI_DESCRIPTION = `Read and modify a Word (.docx), Excel (.xlsx) or PowerPoint (.pptx) file.
Work in layers, preferring the highest one that answers the question:
  L1 read    : command="view" with mode=text|outline|stats|issues|annotated
  L2 edit    : command=get|query|set|add|remove|move|swap with a path like /body/p[1] or /Sheet1/A1
  L3 raw XML : command=raw|raw-set when L2 cannot express it
Elements are addressed by path (/slide[1]/shape[2], /body/tbl[1], /Sheet1/A1).
Call with command="validate" to check a document, or command="view" mode="issues" to list problems.
Before another program reads the file, call command="save" to flush it to disk.`

export interface OfficeToolOptions {
  /**
   * When set, the tool is bound to this one document: the model cannot point it
   * at any other file (path-traversal / arbitrary-file-edit guard).
   */
  allowedFile?: string
}

function samePath(a: string, b: string): boolean {
  const na = resolve(a)
  const nb = resolve(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

export function createOfficeAgentTools(options: OfficeToolOptions = {}): ToolSet | undefined {
  if (!officeCliService.available) return undefined

  const { allowedFile } = options

  return {
    officecli: tool({
      description: allowedFile
        ? `${OFFICECLI_DESCRIPTION}\nThe target document is fixed: ${allowedFile}. Do NOT pass a 'file' argument.`
        : OFFICECLI_DESCRIPTION,
      inputSchema: z.object({
        file: allowedFile
          ? z.string().optional().describe('Ignored — the document is fixed for this session')
          : z.string().describe('Absolute path to the .docx/.xlsx/.pptx file to operate on'),
        command: z.enum(RESIDENT_VERBS).describe('Operation to perform'),
        mode: z
          .string()
          .optional()
          .describe('For command="view": text | outline | stats | issues | annotated'),
        path: z.string().optional().describe('Element path, e.g. /body/p[1] or /Sheet1/A1'),
        parent: z.string().optional().describe('Parent path for command="add"'),
        type: z.string().optional().describe('Element type for command="add", e.g. paragraph'),
        depth: z.number().optional().describe('Child depth for command="get"'),
        to: z.string().optional().describe('Target parent for command="move"'),
        props: z
          .record(z.string(), z.string())
          .optional()
          .describe('Properties to set, e.g. { text: "Hello", style: "Heading1" }')
      }),
      execute: async (input: {
        file?: string
        command: (typeof RESIDENT_VERBS)[number]
        mode?: string
        path?: string
        parent?: string
        type?: string
        depth?: number
        to?: string
        props?: Record<string, string>
      }) => {
        const target = allowedFile ?? input.file
        if (!target) {
          return JSON.stringify({ success: false, error: 'Missing target file path' })
        }
        if (allowedFile && input.file && !samePath(input.file, allowedFile)) {
          Logger.warn('OfficeAgent', `Blocked tool call to a non-allowed file: ${input.file}`)
          return JSON.stringify({
            success: false,
            error: `This tool is restricted to ${allowedFile}; other files are not accessible.`
          })
        }

        const item: Record<string, unknown> = { command: input.command }
        if (input.mode) item.mode = input.mode
        if (input.path) item.path = input.path
        if (input.parent) item.parent = input.parent
        if (input.type) item.type = input.type
        if (input.depth) item.depth = input.depth
        if (input.to) item.to = input.to
        if (input.props) item.props = input.props

        Logger.info('OfficeAgent', `${input.command} ${target} ${input.path ?? ''}`)
        const result = await officeCliService.run(target, item)
        const text = JSON.stringify(result)
        return text.length > MAX_RESULT_CHARS
          ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated)`
          : text
      }
    }),

    load_skill: tool({
      description:
        'Load officecli usage guidance before doing complex document work. Without a name it lists available skills; with a name it returns that skill document.',
      inputSchema: z.object({
        name: z.string().optional().describe('Skill name, e.g. officecli-docx or officecli-pptx')
      }),
      execute: async (input: { name?: string }) => {
        const text = await officeCliService.loadSkill(input.name)
        return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text
      }
    })
  }
}
