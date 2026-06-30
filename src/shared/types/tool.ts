export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  enum?: string[]
  required?: boolean
  properties?: Record<string, ToolParameter>
  items?: ToolParameter
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: string
  error?: string
}

export interface ToolCallStreamChunk {
  type: 'tool-call-start'
  toolCallId: string
  toolName: string
}

export interface ToolCallArgsStreamChunk {
  type: 'tool-call-args'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export interface ToolResultStreamChunk {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  result: string
  error?: string
}
