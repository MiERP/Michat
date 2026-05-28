import { readFile, writeFile } from 'fs/promises'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import ExcelJS from 'exceljs'

function resolvePathValue(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, data)
}

export class DocumentTemplateService {
  async generateWordFromTemplate(
    templatePath: string,
    outputPath: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const templateBuffer = await readFile(templatePath)
    const zip = new PizZip(templateBuffer.toString('binary'))

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true
    })

    doc.render(data)
    const outputBuffer = doc.getZip().generate({ type: 'nodebuffer' })
    await writeFile(outputPath, outputBuffer)
    return outputPath
  }

  async generateExcelFromTemplate(
    templatePath: string,
    outputPath: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(templatePath)

    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value !== 'string') return
          const raw = cell.value

          const exactMatch = raw.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
          if (exactMatch) {
            const resolved = resolvePathValue(data, exactMatch[1])
            if (resolved !== undefined) {
              cell.value = resolved as any
            }
            return
          }

          const replaced = raw.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
            const resolved = resolvePathValue(data, key)
            if (resolved === undefined || resolved === null) return ''
            if (typeof resolved === 'object') return JSON.stringify(resolved)
            return String(resolved)
          })

          cell.value = replaced
        })
      })
    })

    await workbook.xlsx.writeFile(outputPath)
    return outputPath
  }
}
