import Logger from '../../shared/utils/logger'
import type { ToolDefinition, ToolCall, ToolResult } from '../../shared/types/tool'
import type { ChatCitation } from '../../shared/types/chat'

export type ToolExecutor = (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>

export interface ToolExecutionContext {
  notebookId?: string
  citations?: ChatCitation[]
}

interface RegisteredTool {
  definition: ToolDefinition
  executor: ToolExecutor
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    this.tools.set(definition.name, { definition, executor })
    Logger.info('ToolRegistry', `Registered tool: ${definition.name}`)
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition)
  }

  async execute(toolCall: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    const registered = this.tools.get(toolCall.name)
    if (!registered) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        error: `Tool "${toolCall.name}" not found`
      }
    }

    try {
      const result = await registered.executor(toolCall.arguments, context)
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result
      }
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: '',
        error: (error as Error).message
      }
    }
  }

  hasTools(): boolean {
    return this.tools.size > 0
  }
}

export function createBuiltinTools(
  knowledgeService?: {
    search: (notebookId: string, query: string, options: Record<string, unknown>) => Promise<unknown[]>
  }
): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register(
    {
      name: 'search_knowledge_base',
      description: 'Search the user\'s knowledge base for relevant documents and information. Use this when you need to find specific information from documents the user has uploaded.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant documents'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (1-10, default 5)'
          }
        },
        required: ['query']
      }
    },
    async (args, context) => {
      if (!knowledgeService || !context.notebookId) {
        return JSON.stringify({ error: 'Knowledge base not available in this context' })
      }
      const maxResults = Math.min(Math.max(typeof args.maxResults === 'number' ? args.maxResults : 5, 1), 10)
      const results = await knowledgeService.search(context.notebookId, String(args.query), {
        topK: maxResults,
        threshold: 0.5
      })
      return JSON.stringify(
        results.slice(0, maxResults).map((r: any) => ({
          title: r.documentTitle,
          content: (r.content || r.matchedContent || '').slice(0, 500),
          score: r.score,
          chunkId: r.chunkId
        }))
      )
    }
  )

  registry.register(
    {
      name: 'get_current_time',
      description: 'Get the current date and time.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    async () => {
      return JSON.stringify({ datetime: new Date().toISOString() })
    }
  )

  return registry
}
