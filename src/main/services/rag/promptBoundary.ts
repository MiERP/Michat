import { randomUUID } from 'crypto'

/** A per-request boundary marker makes injected closing tags ineffective. */
export function createPromptMarker(): string {
  return `untrusted_documents_${randomUUID()}`
}

/**
 * Neutralize prompt-structure tokens in untrusted content. Retrieved documents
 * and session summaries are evidence, never instructions.
 */
export function sanitizeUntrustedPromptBlock(text: string): string {
  return text
    .replace(/<\/?\s*(documents?|doc)\b[^>]*>/gi, '')
    .replace(/<\s*\/?\s*(documents?|doc)\b/gi, '')
    .replace(/<\/?\s*(system|assistant|user)\s*>/gi, '')
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
    .replace(/<<SYS>>|<\/SYS>>/gi, '')
}
