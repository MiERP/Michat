export const WordToolNames = {
  GET_SELECTION_TEXT: 'word_get_selection_text',
  GET_DOCUMENT_TEXT: 'word_get_document_text',
  GET_DOCUMENT_CONTEXT: 'word_get_document_context',
  REPLACE_SELECTION: 'word_replace_selection',
  INSERT_AT_CURSOR: 'word_insert_at_cursor',
  APPEND_TO_DOCUMENT: 'word_append_to_document'
} as const

export interface OfficeToolDefinition {
  name: string
  host: 'word' | 'excel'
  label: string
  description: string
  mode: 'read' | 'write'
}

export const WORD_TOOLS: OfficeToolDefinition[] = [
  {
    name: WordToolNames.GET_SELECTION_TEXT,
    host: 'word',
    label: 'Get selected text',
    description: 'Read the current Word selection for chat context and quick actions.',
    mode: 'read'
  },
  {
    name: WordToolNames.GET_DOCUMENT_TEXT,
    host: 'word',
    label: 'Get document text',
    description: 'Read Word document text with paragraph-level context.',
    mode: 'read'
  },
  {
    name: WordToolNames.GET_DOCUMENT_CONTEXT,
    host: 'word',
    label: 'Get document context',
    description:
      'Read structured Word context including content, metadata, paragraphs, and outline.',
    mode: 'read'
  },
  {
    name: WordToolNames.REPLACE_SELECTION,
    host: 'word',
    label: 'Replace selection',
    description: 'Replace the current Word selection after user confirmation.',
    mode: 'write'
  },
  {
    name: WordToolNames.INSERT_AT_CURSOR,
    host: 'word',
    label: 'Insert at cursor',
    description:
      'Insert generated text at the current Word cursor or after the current selection after user confirmation.',
    mode: 'write'
  },
  {
    name: WordToolNames.APPEND_TO_DOCUMENT,
    host: 'word',
    label: 'Append to document',
    description: 'Append generated text to the Word document after user confirmation.',
    mode: 'write'
  }
]

export interface WordToolRequest {
  tool: string
  args?: Record<string, unknown>
}
