/**
 * ChatCapability interface
 * Defines the chat capability
 */

import type { APIMessage, StreamChunk } from '../../../shared/types/chat'

/**
 * ChatCapability chat capability interface
 * Providers implementing this interface support chat
 */
export interface ChatCapability {
  /**
   * Stream messages
   * @param messages - Chat message history
   * @param onChunk - Callback invoked when a new chunk is received
   * @param onError - Callback invoked when an error occurs
   * @param onComplete - Callback invoked on completion
   * @returns Promise<AbortController> - AbortController used to cancel the request
   */
  sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController>

  /**
   * Get the default chat model
   * @returns Default model name
   */
  getDefaultChatModel(): string
}
