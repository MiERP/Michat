import { streamText, stepCountIs } from 'ai'
import Logger from '../../../shared/utils/logger'
import { settingsManager } from '../../config'
import { ProviderManager } from '../../providers/ProviderManager'
import { AISDKProvider } from '../../providers/base/AISDKProvider'
import {
  officeCliService,
  type OfficeCliResult,
  type OfficeCliTextResult
} from './OfficeCliService'
import { createOfficeAgentTools } from './agentTools'
import { officeItemsFor } from './markdownToOffice'
import { buildOfficeAgentPrompt, buildOfficeAgentUserPrompt } from './officeAgentPrompt'
import {
  OFFICE_SKILLS,
  resolveOfficeSkill,
  type OfficeDocumentKind,
  type OfficeSkill
} from './officeSkills'

export { OFFICE_SKILLS }
export type { OfficeDocumentKind, OfficeSkill }

/**
 * OfficeAgentService — biến officecli thành một trợ lý văn phòng thực thụ.
 *
 * Thay vì chuyển markdown thô sang tài liệu (chỉ dựng được paragraph/table),
 * service này để LLM TỰ SOẠN tài liệu qua các tool của officecli, đúng cách
 * OfficeCLI được thiết kế: đọc skill → thao tác theo lớp (view/get/add/set/raw)
 * → validate → save. Nếu model không ghi được gì (hoặc lỗi), service tự động
 * fallback về chuyển markdown tất định để người dùng vẫn có tài liệu.
 */

export type OfficeAgentProgressCallback = (stage: string, progress: number) => void

export type OfficeAgentStatus = 'ok' | 'no_provider' | 'engine_unavailable'

export interface OfficeAgentRequest {
  kind: OfficeDocumentKind
  title: string
  /** Skill officecli muốn dùng; 'auto'/bỏ trống → theo định dạng */
  skill?: OfficeSkill
  /** Chỉ dẫn của người dùng (tone, số slide, bố cục…) */
  instruction?: string
  /** Nội dung nguồn (markdown) đã chọn từ notebook */
  sourceContent: string
  outputPath: string
  /**
   * Đường dẫn tài liệu Office có sẵn cần CHỈNH SỬA. Caller (IPC) đã copy sang
   * outputPath; service chỉ soạn trên outputPath và giữ nguyên phần không liên quan.
   */
  editSourcePath?: string
}

export interface OfficeAgentResult {
  success: boolean
  status?: OfficeAgentStatus
  outputPath?: string
  /** True khi model không viết được gì và tài liệu được dựng từ markdown thô */
  usedFallback?: boolean
  /** Số lượt gọi tool của agent (chẩn đoán) */
  toolCalls?: number
  /** Số lần thử soạn bằng AI (1 hoặc 2) */
  attempts?: number
  error?: string
}

const STEP_LIMIT = 16
const AGENT_TIMEOUT_MS = 600000
const MAX_OUTPUT_TOKENS = 8192
const MAX_ATTEMPTS = 2

async function getOfficePrompt(): Promise<string> {
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'vi-VN'
  const prompt = settings.prompts?.office?.[language]
  if (!prompt) {
    throw new Error(`Chưa cấu hình prompt tạo tài liệu cho ngôn ngữ ${language}`)
  }
  return prompt
}

export class OfficeAgentService {
  constructor(private providerManager: ProviderManager) {}

  async generateDocument(
    request: OfficeAgentRequest,
    onProgress?: OfficeAgentProgressCallback
  ): Promise<OfficeAgentResult> {
    if (!officeCliService.available) {
      return {
        success: false,
        status: 'engine_unavailable',
        error: 'Office engine is unavailable on this platform (officecli binary missing).'
      }
    }

    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider || !(provider instanceof AISDKProvider)) {
      return {
        success: false,
        status: 'no_provider',
        error: 'Chưa cấu hình model chat hỗ trợ gọi công cụ. Hãy chọn model trong Cài đặt.'
      }
    }

    const isEdit = !!request.editSourcePath
    // Chế độ tạo mới: tạo file trống. Chế độ chỉnh sửa: IPC đã copy tài liệu gốc
    // sang outputPath nên KHÔNG được tạo lại (sẽ xoá nội dung gốc).
    if (!isEdit) {
      onProgress?.('creating_document', 5)
      const created = await officeCliService.create(request.outputPath, ['--force'])
      if (!created.success) {
        return {
          success: false,
          error: created.error?.error || created.message || 'Không tạo được file trống'
        }
      }
    }

    const tools = createOfficeAgentTools({ allowedFile: request.outputPath })
    if (!tools) {
      return { success: false, status: 'engine_unavailable', error: 'Office tools unavailable' }
    }

    const skill = resolveOfficeSkill(request.kind, request.skill)
    if (isEdit) onProgress?.('editing_document', 10)
    let toolCalls = 0
    let attempts = 0
    let authored = false

    // Tối đa 2 lượt: lượt 2 chỉ chạy khi file vẫn trống sau lượt đầu (model
    // thường "quên" ghi nội dung ở lần đầu với prompt dài).
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !authored; attempt++) {
      attempts = attempt
      try {
        const systemPrompt = buildOfficeAgentPrompt(await getOfficePrompt(), {
          file: request.outputPath,
          kind: request.kind,
          title: request.title
        })
        toolCalls += await this.runAgent(
          provider,
          systemPrompt,
          request,
          tools,
          skill,
          attempt,
          onProgress
        )
      } catch (error) {
        // Lỗi agent không làm hỏng cả tác vụ: rơi xuống fallback markdown.
        Logger.warn('OfficeAgent', `Agent run (attempt ${attempt}) failed:`, error)
      }

      await this.flush(request.outputPath)
      authored = await this.hasContent(request.outputPath)
      if (!authored && attempt < MAX_ATTEMPTS) {
        onProgress?.('retrying_document', 60)
      }
    }

    // Vẫn trống → dựng tài liệu tất định từ markdown để người dùng có kết quả.
    // KHÔNG áp dụng cho chế độ chỉnh sửa: ghi đè markdown sẽ phá tài liệu gốc.
    let usedFallback = false
    if (!isEdit && !authored && request.sourceContent.trim()) {
      usedFallback = true
      try {
        const items = officeItemsFor(request.kind, request.sourceContent, { title: request.title })
        if (items.length > 0) {
          await officeCliService.batch(request.outputPath, items, { bestEffort: true })
        }
      } catch (error) {
        Logger.warn('OfficeAgent', 'Markdown fallback failed:', error)
      }
      await this.flush(request.outputPath)
    }

    onProgress?.('completed', 100)
    return {
      success: true,
      status: 'ok',
      outputPath: request.outputPath,
      usedFallback,
      toolCalls,
      attempts
    }
  }

  private async runAgent(
    provider: AISDKProvider,
    systemPrompt: string,
    request: OfficeAgentRequest,
    tools: NonNullable<ReturnType<typeof createOfficeAgentTools>>,
    skill: string,
    attempt: number,
    onProgress?: OfficeAgentProgressCallback
  ): Promise<number> {
    const model = provider.getAIModel()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS)

    const userPrompt = buildOfficeAgentUserPrompt({
      instruction: request.instruction,
      skill,
      attempt,
      sourceContent: request.sourceContent,
      isEdit: !!request.editSourcePath
    })

    let toolCalls = 0
    try {
      onProgress?.('generating_document', attempt === 1 ? 15 : 60)
      const result = streamText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        tools,
        stopWhen: stepCountIs(STEP_LIMIT),
        temperature: 0.4,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        maxRetries: 0,
        abortSignal: controller.signal
      })

      for await (const part of result.fullStream) {
        if (controller.signal.aborted) break
        const type = (part as { type?: string }).type
        if (type === 'error') {
          const raw = (part as { error?: unknown }).error
          throw raw instanceof Error ? raw : new Error('Agent stream error')
        }
        if (type === 'tool-call') {
          toolCalls++
          const base = attempt === 1 ? 15 : 60
          onProgress?.(
            'generating_document',
            Math.min(base + toolCalls * 6, attempt === 1 ? 85 : 88)
          )
        }
      }

      // Đảm bảo stream đã kết thúc trước khi save.
      await result.text.catch(() => '')
      return toolCalls
    } finally {
      clearTimeout(timer)
    }
  }

  private async flush(outputPath: string): Promise<void> {
    await officeCliService.save(outputPath).catch(() => undefined)
    await officeCliService.closeDocument(outputPath).catch(() => undefined)
  }

  private async hasContent(outputPath: string): Promise<boolean> {
    try {
      const text = (await officeCliService.viewText(
        outputPath
      )) as OfficeCliResult<OfficeCliTextResult>
      const data = text?.data
      if (!data) return false
      if (typeof data.totalElements === 'number' && data.totalElements > 0) return true
      if (typeof data.totalSlides === 'number' && data.totalSlides > 0) return true
      return (
        Array.isArray(data.elements) &&
        data.elements.some((el) => (el.text ?? '').trim().length > 0)
      )
    } catch (error) {
      Logger.warn('OfficeAgent', 'Could not verify document content:', error)
      return false
    }
  }
}
