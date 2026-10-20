import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { copyFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { isAllowedOfficeReadPath, normalizeFsPath } from '../security/guards'
import { createOfficeWindow } from '../windows/officeWindow'
import type { OfficeCliService } from '../services/officecli/OfficeCliService'
import { OfficeAgentService } from '../services/officecli/OfficeAgentService'
import { OFFICE_SKILLS } from '../services/officecli/officeSkills'
import type { KnowledgeService } from '../services/KnowledgeService'
import type { ProviderManager } from '../providers/ProviderManager'
import { officeItemsFor } from '../services/officecli/markdownToOffice'
import { validate, validateWithEvent } from './validation'

/**
 * IPC surface for the bundled officecli engine.
 *
 * Path safety follows the same convention as the knowledge import handlers: the
 * renderer may only write to paths the user picked through a native dialog,
 * tracked in `approvedOutputPaths`. Reads are allowed on any path already
 * registered as a MiChat-produced document.
 */

const OFFICE_EXTENSIONS: Record<'docx' | 'xlsx' | 'pptx', string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx'
}

const approvedOutputPaths = new Set<string>()
const knownDocumentPaths = new Set<string>()

const OfficeSchemas = {
  selectOutput: z.object({
    kind: z.enum(['docx', 'xlsx', 'pptx']),
    defaultName: z.string().min(1).max(200)
  }),
  export: z.object({
    kind: z.enum(['docx', 'xlsx', 'pptx']),
    title: z.string().min(1).max(300),
    markdown: z.string().min(1),
    outputPath: z.string().min(1),
    notebookId: z.string().min(1)
  }),
  generate: z.object({
    kind: z.enum(['docx', 'xlsx', 'pptx']),
    title: z.string().min(1).max(300),
    skill: z.enum(OFFICE_SKILLS).optional(),
    instruction: z.string().max(4000).optional(),
    markdown: z.string(),
    outputPath: z.string().min(1),
    notebookId: z.string().min(1),
    /** Tuỳ chọn: đường dẫn tài liệu Office có sẵn cần chỉnh sửa (bản sao lưu ra outputPath) */
    templatePath: z.string().min(1).optional()
  }),
  documentPath: z.object({
    filePath: z.string().min(1)
  })
}

function rememberDocument(filePath: string): string {
  const normalized = normalizeFsPath(filePath)
  knownDocumentPaths.add(normalized)
  return normalized
}

/**
 * Nạp lại tài liệu vừa tạo vào KB của notebook (để chat/quiz dùng tiếp) rồi
 * báo cho các cửa sổ refresh. Fire-and-forget: lỗi chỉ log, không làm fail
 * luồng tạo tài liệu.
 */
function reimportToKnowledge(
  knowledgeService: KnowledgeService,
  notebookId: string,
  outputPath: string
): void {
  void knowledgeService
    .importGeneratedFile(notebookId, outputPath)
    .then((documentId) => {
      Logger.info('OfficeIPC', `Re-imported generated document into KB: ${documentId}`)
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('knowledge:documents-changed', { notebookId })
        }
      }
    })
    .catch((error) => {
      Logger.warn('OfficeIPC', 'KB re-import of generated document failed:', error)
    })
}

export function registerOfficeHandlers(
  officeCliService: OfficeCliService,
  knowledgeService: KnowledgeService,
  providerManager: ProviderManager
): void {
  const officeAgentService = new OfficeAgentService(providerManager)

  const canReadDocument = (filePath: string): boolean =>
    isAllowedOfficeReadPath(filePath, knownDocumentPaths, (path) =>
      knowledgeService.isManagedLocalFilePath(path)
    )

  ipcMain.handle('office:status', async () => {
    const status = officeCliService.status
    return {
      ...status,
      workspaceDir: status.available ? officeCliService.workspaceDir : null
    }
  })

  ipcMain.handle(
    'office:select-output',
    validate(OfficeSchemas.selectOutput, async (params) => {
      const extension = OFFICE_EXTENSIONS[params.kind]
      const result = await dialog.showSaveDialog({
        title: 'Save generated document',
        defaultPath: `${params.defaultName}.${extension}`,
        filters: [
          {
            name:
              params.kind === 'docx'
                ? 'Word Document'
                : params.kind === 'xlsx'
                  ? 'Excel Workbook'
                  : 'PowerPoint Presentation',
            extensions: [extension]
          }
        ]
      })

      if (result.canceled || !result.filePath) return null
      const selectedPath = normalizeFsPath(result.filePath)
      approvedOutputPaths.add(selectedPath)
      return selectedPath
    })
  )

  ipcMain.handle(
    'office:export',
    validate(OfficeSchemas.export, async (params) => {
      try {
        if (!officeCliService.available) {
          return {
            success: false,
            error: 'Office engine is unavailable on this platform (officecli binary missing).'
          }
        }

        const outputPath = normalizeFsPath(params.outputPath)
        if (!approvedOutputPaths.has(outputPath)) {
          return {
            success: false,
            error: 'Output path must be selected via the system save dialog'
          }
        }
        approvedOutputPaths.delete(outputPath)

        const created = await officeCliService.create(outputPath, ['--force'])
        if (!created.success) {
          return {
            success: false,
            error: created.error?.error || created.message || 'create failed'
          }
        }

        const items = officeItemsFor(params.kind, params.markdown, { title: params.title })
        if (items.length > 0) {
          const applied = await officeCliService.batch(outputPath, items, { bestEffort: true })
          if (!applied.success) {
            Logger.warn('OfficeIPC', `Export applied with warnings: ${applied.message ?? ''}`)
          }
        }

        await officeCliService.save(outputPath)
        await officeCliService.closeDocument(outputPath)
        rememberDocument(outputPath)

        const warnings = items.length
        Logger.info('OfficeIPC', `Exported ${params.kind} (${warnings} blocks) -> ${outputPath}`)

        // Khép vòng: nạp lại tài liệu vừa tạo vào KB của notebook để chat/quiz dùng tiếp.
        reimportToKnowledge(knowledgeService, params.notebookId, outputPath)

        return { success: true, outputPath }
      } catch (error) {
        Logger.error('OfficeIPC', 'Export failed:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  // Tạo tài liệu bằng AI: LLM tự soạn qua officecli (đọc skill → add/set → validate
  // → save), có tiến độ; UI hiển thị tiến độ và xem trước kết quả.
  ipcMain.handle(
    'office:generate',
    validateWithEvent(OfficeSchemas.generate, async (event, params) => {
      try {
        if (!officeCliService.available) {
          return {
            success: false,
            status: 'engine_unavailable',
            error: 'Office engine is unavailable on this platform (officecli binary missing).'
          }
        }

        const outputPath = normalizeFsPath(params.outputPath)
        if (!approvedOutputPaths.has(outputPath)) {
          return {
            success: false,
            error: 'Output path must be selected via the system save dialog'
          }
        }
        approvedOutputPaths.delete(outputPath)

        // Chế độ chỉnh sửa: tài liệu gốc phải là file do MiChat quản lý
        // (knowledge-files) để không cho phép đọc/ghi file tuỳ ý trên đĩa.
        let templatePath: string | undefined
        if (params.templatePath) {
          templatePath = normalizeFsPath(params.templatePath)
          if (!knowledgeService.isManagedLocalFilePath(templatePath) || !existsSync(templatePath)) {
            return {
              success: false,
              error: 'Tài liệu nguồn không hợp lệ hoặc không còn tồn tại trong kho tri thức.'
            }
          }
          try {
            await copyFile(templatePath, outputPath)
          } catch (error) {
            return {
              success: false,
              error: `Không sao chép được tài liệu nguồn: ${(error as Error).message}`
            }
          }
        }

        const result = await officeAgentService.generateDocument(
          {
            kind: params.kind,
            title: params.title,
            skill: params.skill,
            instruction: params.instruction,
            sourceContent: params.markdown,
            outputPath,
            editSourcePath: templatePath
          },
          (stage, progress) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('office:generate-progress', { outputPath, stage, progress })
            }
          }
        )

        if (result.success && result.outputPath) {
          rememberDocument(result.outputPath)
          Logger.info(
            'OfficeIPC',
            `AI-generated ${params.kind} -> ${result.outputPath} (toolCalls=${result.toolCalls ?? 0}, fallback=${!!result.usedFallback})`
          )
          reimportToKnowledge(knowledgeService, params.notebookId, result.outputPath)
        }

        return result
      } catch (error) {
        Logger.error('OfficeIPC', 'AI generation failed:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  ipcMain.handle(
    'office:render-preview',
    validate(OfficeSchemas.documentPath, async (params) => {
      try {
        const filePath = normalizeFsPath(params.filePath)
        if (!canReadDocument(filePath)) {
          return {
            success: false,
            error: 'Document path is not a MiChat-managed document (export/generate first).'
          }
        }
        if (!existsSync(filePath)) {
          return { success: false, error: 'Document no longer exists on disk' }
        }
        const html = await officeCliService.html(filePath)
        return { success: true, html }
      } catch (error) {
        Logger.error('OfficeIPC', 'Preview failed:', error)
        return { success: false, error: (error as Error).message }
      }
    })
  )

  ipcMain.handle(
    'office:validate',
    validate(OfficeSchemas.documentPath, async (params) => {
      const filePath = normalizeFsPath(params.filePath)
      if (!canReadDocument(filePath)) {
        return { success: false, message: 'Document path is not a MiChat-managed document.' }
      }
      const result = await officeCliService.validate(filePath)
      return { success: result.success, message: result.message ?? null }
    })
  )

  ipcMain.handle(
    'office:issues',
    validate(OfficeSchemas.documentPath, async (params) => {
      const filePath = normalizeFsPath(params.filePath)
      if (!canReadDocument(filePath)) {
        return { success: false, count: 0, issues: [] }
      }
      const result = await officeCliService.viewIssues(filePath)
      return {
        success: result.success,
        count: result.data?.count ?? 0,
        issues: result.data?.issues ?? []
      }
    })
  )

  ipcMain.handle(
    'office:open-file',
    validate(OfficeSchemas.documentPath, async (params) => {
      const filePath = normalizeFsPath(params.filePath)
      if (!canReadDocument(filePath)) {
        return { success: false, error: 'Document path is not a MiChat-managed document.' }
      }
      if (!existsSync(filePath)) {
        return { success: false, error: 'Document no longer exists on disk' }
      }
      const error = await shell.openPath(filePath)
      return error ? { success: false, error } : { success: true }
    })
  )

  ipcMain.handle('office:workspace-dir', () => officeCliService.workspaceDir)

  ipcMain.handle(
    'office:open-window',
    validate(z.object({ notebookId: z.string().min(1) }), async (params) => {
      createOfficeWindow(params.notebookId)
      return { success: true }
    })
  )

  ipcMain.handle(
    'office:default-output-path',
    (_, args: { kind: 'docx' | 'xlsx' | 'pptx'; name: string }) => {
      const safeName = String(args?.name || 'document')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 120)
      const outputPath = normalizeFsPath(
        join(officeCliService.workspaceDir, `${safeName}.${args?.kind ?? 'docx'}`)
      )
      approvedOutputPaths.add(outputPath)
      return outputPath
    }
  )
}

export { approvedOutputPaths as officeApprovedOutputPaths }
