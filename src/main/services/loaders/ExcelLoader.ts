/**
 * ExcelLoader
 * Parse XLSX files and preserve table structure for chunking.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import ExcelJS from 'exceljs'
import Logger from '../../../shared/utils/logger'
import type { IDocumentLoader, DocumentLoadResult } from './types'

interface TableBlock {
  sheet: string
  startOffset: number
  endOffset: number
  rowCount: number
  columnCount: number
}

export class ExcelLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']

  readonly supportedExtensions = ['xlsx']

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase()
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.includes(extname(lower).slice(1))
    )
  }

  async loadFromPath(filePath: string): Promise<DocumentLoadResult> {
    const buffer = await readFile(filePath)
    return this.loadFromBuffer(buffer)
  }

  async loadFromBuffer(buffer: Buffer): Promise<DocumentLoadResult> {
    try {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buffer)

      const chunks: string[] = []
      const tables: TableBlock[] = []
      let currentOffset = 0

      workbook.eachSheet((worksheet) => {
        const rows: Array<Array<string | number | boolean | Date | null>> = []
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : []
          rows.push(values as Array<string | number | boolean | Date | null>)
        })

        const normalizedRows = rows.filter((row) =>
          row.some((cell) => String(cell ?? '').trim().length > 0)
        )

        if (normalizedRows.length === 0) return

        const header = normalizedRows[0].map((cell) => String(cell ?? '').trim())
        const dataRows = normalizedRows.slice(1)
        const columnCount = Math.max(header.length, ...normalizedRows.map((r) => r.length))

        const lines: string[] = []
        lines.push(
          `[[TABLE_START:sheet=${worksheet.name};rows=${normalizedRows.length};cols=${columnCount}]]`
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
          sheet: worksheet.name,
          startOffset: currentOffset,
          endOffset: currentOffset + blockText.length,
          rowCount: normalizedRows.length,
          columnCount
        })

        currentOffset += blockText.length
      })

      const content = chunks.join('').trim()
      if (!content) {
        throw new Error('No readable worksheet content found')
      }

      return {
        content,
        title: workbook.title,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: {
          sheetCount: workbook.worksheets.length,
          sheets: workbook.worksheets.map((sheet) => sheet.name),
          tables
        }
      }
    } catch (error) {
      Logger.error('ExcelLoader', 'Failed to parse Excel file:', error)
      throw new Error(`Failed to parse Excel file: ${(error as Error).message}`)
    }
  }
}