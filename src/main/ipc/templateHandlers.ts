import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { DocumentTemplateService } from '../services/DocumentTemplateService'
import { validate } from './validation'
import { normalizeFsPath } from '../security/guards'

const templateService = new DocumentTemplateService()
const approvedTemplatePaths = new Set<string>()
const approvedOutputPaths = new Set<string>()

const TemplateSchemas = {
  generateWord: z.object({
    templatePath: z.string().min(1),
    outputPath: z.string().min(1),
    data: z.record(z.string(), z.unknown())
  }),
  generateExcel: z.object({
    templatePath: z.string().min(1),
    outputPath: z.string().min(1),
    data: z.record(z.string(), z.unknown())
  })
}

export function registerTemplateHandlers() {
  ipcMain.handle('templates:select-template', async (_, args: { kind: 'word' | 'excel' }) => {
    const filters =
      args.kind === 'excel'
        ? [{ name: 'Excel Templates', extensions: ['xlsx'] }]
        : [{ name: 'Word Templates', extensions: ['docx'] }]

    const result = await dialog.showOpenDialog({
      title: args.kind === 'excel' ? 'Select Excel template' : 'Select Word template',
      filters,
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const selectedPath = normalizeFsPath(result.filePaths[0])
    approvedTemplatePaths.add(selectedPath)
    return selectedPath
  })

  ipcMain.handle('templates:select-output', async (_, args: { kind: 'word' | 'excel' }) => {
    const defaultExtension = args.kind === 'excel' ? 'xlsx' : 'docx'
    const filters =
      args.kind === 'excel'
        ? [{ name: 'Excel Files', extensions: ['xlsx'] }]
        : [{ name: 'Word Files', extensions: ['docx'] }]

    const result = await dialog.showSaveDialog({
      title: args.kind === 'excel' ? 'Save generated Excel file' : 'Save generated Word file',
      defaultPath: `generated.${defaultExtension}`,
      filters
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const selectedPath = normalizeFsPath(result.filePath)
    approvedOutputPaths.add(selectedPath)
    return selectedPath
  })

  ipcMain.handle(
    'templates:generate-word',
    validate(TemplateSchemas.generateWord, async (params) => {
      try {
        const normalizedTemplatePath = normalizeFsPath(params.templatePath)
        const normalizedOutputPath = normalizeFsPath(params.outputPath)
        if (!approvedTemplatePaths.has(normalizedTemplatePath)) {
          throw new Error('Template path must be selected via the system file picker')
        }
        if (!approvedOutputPaths.has(normalizedOutputPath)) {
          throw new Error('Output path must be selected via the system save dialog')
        }

        approvedTemplatePaths.delete(normalizedTemplatePath)
        approvedOutputPaths.delete(normalizedOutputPath)

        const outputPath = await templateService.generateWordFromTemplate(
          normalizedTemplatePath,
          normalizedOutputPath,
          params.data
        )
        return { success: true, outputPath }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    })
  )

  ipcMain.handle(
    'templates:generate-excel',
    validate(TemplateSchemas.generateExcel, async (params) => {
      try {
        const normalizedTemplatePath = normalizeFsPath(params.templatePath)
        const normalizedOutputPath = normalizeFsPath(params.outputPath)
        if (!approvedTemplatePaths.has(normalizedTemplatePath)) {
          throw new Error('Template path must be selected via the system file picker')
        }
        if (!approvedOutputPaths.has(normalizedOutputPath)) {
          throw new Error('Output path must be selected via the system save dialog')
        }

        approvedTemplatePaths.delete(normalizedTemplatePath)
        approvedOutputPaths.delete(normalizedOutputPath)

        const outputPath = await templateService.generateExcelFromTemplate(
          normalizedTemplatePath,
          normalizedOutputPath,
          params.data
        )
        return { success: true, outputPath }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    })
  )
}
