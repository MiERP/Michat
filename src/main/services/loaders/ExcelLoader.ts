/**
 * ExcelLoader
 * Parse XLSX/XLS files and preserve table structure for chunking.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import * as XLSX from 'xlsx'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult, LoadOptions } from './types'

interface TableBlock {
  sheet: string
  startOffset: number
  endOffset: number
  rowCount: number
  columnCount: number
}

export class ExcelLoader implements IDocumentLoader {
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]

  readonly supportedExtensions = ['xlsx', 'xls']

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.includes(extname(lower).slice(1))
    )
  }

  async loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult> {
    const buffer = await readFile(filePath)
    return this.loadFromBuffer(buffer, options)
  }

  async loadFromBuffer(buffer: Buffer, _options?: LoadOptions): Promise<DocumentLoadResult> {
    try {
      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        dense: true
      })

      const chunks: string[] = []
      const tables: TableBlock[] = []
      let currentOffset = 0

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue

        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          raw: false
        }) as Array<Array<string | number | boolean | null>>

        if (rows.length === 0) continue

        const normalizedRows = rows
          .map((row) => (Array.isArray(row) ? row : []))
          .filter((row) => row.some((cell) => String(cell ?? '').trim().length > 0))

        if (normalizedRows.length === 0) continue

        const header = normalizedRows[0].map((cell) => String(cell ?? '').trim())
        const dataRows = normalizedRows.slice(1)
        const columnCount = Math.max(header.length, ...normalizedRows.map((r) => r.length))

        const lines: string[] = []
        lines.push(
          `[[TABLE_START:sheet=${sheetName};rows=${normalizedRows.length};cols=${columnCount}]]`
        )

        if (header.length > 0) {
          lines.push(`header: ${header.join(' | ')}`)
        }

        dataRows.forEach((row, rowIndex) => {
          const cols = row.map((cell) => String(cell ?? '').trim())
          lines.push(`row ${rowIndex + 1}: ${cols.join(' | ')}`)
        })

        lines.push('[[TABLE_END]]')

        const blockText = lines.join('\n') + '\n\n'
        chunks.push(blockText)

        tables.push({
          sheet: sheetName,
          startOffset: currentOffset,
          endOffset: currentOffset + blockText.length,
          rowCount: normalizedRows.length,
          columnCount
        })

        currentOffset += blockText.length
      }

      const content = chunks.join('').trim()
      if (!content) {
        throw new Error('No readable worksheet content found')
      }

      return {
        content,
        title: workbook.Props?.Title,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: {
          sheetCount: workbook.SheetNames.length,
          sheets: workbook.SheetNames,
          tables
        }
      }
    } catch (error) {
      Logger.error('ExcelLoader', 'Failed to parse Excel file:', error)
      throw new Error(`Failed to parse Excel file: ${(error as Error).message}`)
    }
  }
}
