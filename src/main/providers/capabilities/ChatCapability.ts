/**
 * ChatCapability 接口
 * 定义对话能力
 */

import type { APIMessage, StreamChunk } from '../../../shared/types/chat'
import type { ToolDefinition } from '../../../shared/types/tool'

export interface ChatCapability {
  sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void,
    tools?: ToolDefinition[]
  ): Promise<AbortController>

  getDefaultChatModel(): string
}
