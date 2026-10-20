import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

/**
 * Converts notebook/note markdown into officecli batch items.
 *
 * Only the top-level block structure is mapped — headings, paragraphs, lists,
 * quotes and GFM tables — because that is what note content actually contains
 * and it keeps the generated documents predictable. Inline emphasis is flattened
 * to plain text: officecli addresses runs by path, so preserving it would mean
 * emitting one run per emphasis span for little practical gain.
 */

export interface OfficeBatchItem {
  command: string
  [key: string]: unknown
}

type MdNode = {
  type: string
  depth?: number
  value?: string
  children?: MdNode[]
  ordered?: boolean | null
  start?: number | null
  align?: (string | null)[]
  lang?: string | null
  url?: string
}

const HEADING_STYLES = ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6']

function parse(markdown: string): MdNode {
  const processor = unified().use(remarkParse).use(remarkGfm)
  return processor.parse(markdown) as unknown as MdNode
}

/** Flatten a node subtree to plain text (drops emphasis, keeps link labels). */
function textOf(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'code') return node.value ?? ''
  if (node.type === 'break') return '\n'
  if (!node.children) return ''
  return node.children.map(textOf).join('')
}

/** Split a table row into cell texts. */
function cellsOf(row: MdNode): string[] {
  return (row.children ?? []).map((cell) => textOf(cell).replace(/\s+/g, ' ').trim())
}

function sanitizeSheetName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
  return cleaned.length > 0 ? cleaned : fallback
}

function paragraph(text: string, style?: string): OfficeBatchItem | null {
  const value = text.trim()
  if (!value) return null
  const props: Record<string, unknown> = { text: value }
  if (style) props.style = style
  return { command: 'add', parent: '/body', type: 'paragraph', props }
}

/** Walk list items, emitting one paragraph per item with the right list style. */
function listItems(node: MdNode, out: OfficeBatchItem[]): void {
  const style = node.ordered ? 'ListNumber' : 'ListBullet'
  for (const item of node.children ?? []) {
    const parts: string[] = []
    for (const child of item.children ?? []) {
      if (child.type === 'paragraph') {
        parts.push(textOf(child).trim())
      } else if (child.type === 'list') {
        listItems(child, out)
      }
    }
    const text = parts.filter(Boolean).join(' ')
    const entry = paragraph(text, style)
    if (entry) out.push(entry)
  }
}

/** Build the officecli table `data` prop: semicolon-separated rows, comma cells. */
function tableData(rows: string[][]): string {
  return rows
    .map((cells) =>
      cells
        .map((cell) => {
          const value = cell.trim()
          return /[",;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(',')
    )
    .join(';')
}

export interface ConversionOptions {
  title?: string
  maxSlides?: number
}

/** Word (.docx) batch items. */
export function docxItems(markdown: string, options: ConversionOptions = {}): OfficeBatchItem[] {
  const root = parse(markdown)
  const out: OfficeBatchItem[] = []

  if (options.title) {
    const title = paragraph(options.title, 'Title')
    if (title) out.push(title)
  }

  for (const node of root.children ?? []) {
    switch (node.type) {
      case 'heading': {
        const item = paragraph(textOf(node), HEADING_STYLES[(node.depth ?? 1) - 1])
        if (item) out.push(item)
        break
      }
      case 'paragraph': {
        const item = paragraph(textOf(node))
        if (item) out.push(item)
        break
      }
      case 'list':
        listItems(node, out)
        break
      case 'blockquote': {
        const text = (node.children ?? []).map(textOf).join(' ').trim()
        const item = paragraph(text, 'Quote')
        if (item) out.push(item)
        break
      }
      case 'code': {
        const item = paragraph(node.value ?? '', 'Quote')
        if (item) out.push(item)
        break
      }
      case 'table': {
        const rows = (node.children ?? []).map(cellsOf).filter((r) => r.length > 0)
        if (rows.length === 0) break
        out.push({
          command: 'add',
          parent: '/body',
          type: 'table',
          props: { data: tableData(rows), style: 'light1', width: '100%' }
        })
        break
      }
      default:
        break
    }
  }

  return out
}

/** PowerPoint (.pptx) batch items: one slide per level-1/2 heading plus its body. */
export function pptxItems(markdown: string, options: ConversionOptions = {}): OfficeBatchItem[] {
  const root = parse(markdown)
  const maxSlides = options.maxSlides ?? 60

  const slides: { title: string; bullets: string[] }[] = []
  let current: { title: string; bullets: string[] } | null = null

  const ensureSlide = (): { title: string; bullets: string[] } => {
    if (!current) {
      current = { title: options.title ?? 'Overview', bullets: [] }
      slides.push(current)
    }
    return current
  }

  for (const node of root.children ?? []) {
    if (node.type === 'heading' && (node.depth ?? 1) <= 2) {
      current = { title: textOf(node).trim() || `Slide ${slides.length + 1}`, bullets: [] }
      slides.push(current)
      continue
    }

    if (node.type === 'list') {
      const target = ensureSlide()
      for (const item of node.children ?? []) {
        const text = (item.children ?? []).map(textOf).join(' ').trim()
        if (text) target.bullets.push(text)
      }
      continue
    }

    if (node.type === 'table') {
      const target = ensureSlide()
      const rows = (node.children ?? [])
        .map(cellsOf)
        .filter((r) => r.length > 0)
        .slice(0, 8)
      for (const row of rows) target.bullets.push(row.join('  |  '))
      continue
    }

    const text = textOf(node).trim()
    if (text) ensureSlide().bullets.push(text)
  }

  if (slides.length === 0) slides.push({ title: options.title ?? 'Overview', bullets: [] })

  const out: OfficeBatchItem[] = []
  for (const slide of slides.slice(0, maxSlides)) {
    const props: Record<string, unknown> = {
      title: slide.title.slice(0, 200),
      layout: 'Title and Content'
    }
    if (slide.bullets.length > 0) props.text = slide.bullets.slice(0, 12).join('\n')
    out.push({ command: 'add', parent: '/', type: 'slide', props })
  }
  return out
}

/** Excel (.xlsx) batch items: one sheet per markdown table, text in column A otherwise. */
export function xlsxItems(markdown: string, options: ConversionOptions = {}): OfficeBatchItem[] {
  const root = parse(markdown)
  const out: OfficeBatchItem[] = []
  const sheets: { name: string; rows: string[][] }[] = []
  let lastHeading = options.title ?? 'Sheet1'

  for (const node of root.children ?? []) {
    if (node.type === 'heading') {
      lastHeading = textOf(node).trim() || lastHeading
      continue
    }
    if (node.type === 'table') {
      const rows = (node.children ?? []).map(cellsOf).filter((r) => r.length > 0)
      if (rows.length > 0) {
        sheets.push({ name: sanitizeSheetName(lastHeading, `Sheet${sheets.length + 1}`), rows })
      }
    }
  }

  if (sheets.length === 0) {
    const lines = markdown
      .split('\n')
      .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 500)
    sheets.push({
      name: sanitizeSheetName(options.title ?? 'Content', 'Sheet1'),
      rows: lines.map((line) => [line])
    })
  }

  const used = new Set<string>()
  for (const sheet of sheets) {
    let name = sheet.name
    let suffix = 2
    while (used.has(name.toLowerCase())) {
      name = `${sheet.name.slice(0, 28)}_${suffix++}`
    }
    used.add(name.toLowerCase())

    out.push({ command: 'add', parent: '/', type: 'sheet', props: { name } })

    const width = Math.max(...sheet.rows.map((r) => r.length))
    sheet.rows.slice(0, 2000).forEach((row, rowIndex) => {
      for (let col = 0; col < Math.min(width, 50); col++) {
        const value = (row[col] ?? '').trim()
        if (!value) continue
        const column = String.fromCharCode(65 + (col % 26))
        out.push({
          command: 'set',
          path: `/${name}/${column}${rowIndex + 1}`,
          props: { value }
        })
      }
    })
  }

  return out
}

export function officeItemsFor(
  kind: 'docx' | 'xlsx' | 'pptx',
  markdown: string,
  options: ConversionOptions = {}
): OfficeBatchItem[] {
  if (kind === 'xlsx') return xlsxItems(markdown, options)
  if (kind === 'pptx') return pptxItems(markdown, options)
  return docxItems(markdown, options)
}
