/**
 * MindMapService
 * 思维导图服务 - 生成和管理笔记本的派生知识结构
 */

import { getDatabase, executeCheckpoint } from '../db'
import { mindMaps, documents, chunks, notebooks, items } from '../db/schema'
import type { MindMap, NewMindMap } from '../db/schema'
import type { MindMapTreeNode, MindMapGenerationResult } from '../../shared/types/mindmap'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { ProviderManager } from '../providers/ProviderManager'
import { AISDKProvider } from '../providers/base/AISDKProvider'
import { streamObject } from 'ai'
import { z } from 'zod'
import Logger from '../../shared/utils/logger'
import { settingsManager } from '../config'

export type MindMapProgressCallback = (stage: string, progress: number) => void

const MAX_SOURCE_DOCS = 10
const MAX_CHUNKS_PER_DOC = 4
const MAX_CHARS_PER_CHUNK = 900
const MAX_PROMPT_CONTENT_CHARS = 28000

type QualityMode = 'fast' | 'balanced' | 'accurate'

function getQualityMode(): QualityMode {
  const mode = (process.env.KN_GEN_QUALITY || 'balanced').toLowerCase()
  if (mode === 'fast' || mode === 'accurate') return mode
  return 'balanced'
}

const MindMapNodeSchema: z.ZodType<MindMapTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().describe('节点唯一ID'),
    label: z.string().max(24).describe('节点标签，中文≤12字，英文≤24字符'),
    children: z.array(MindMapNodeSchema).optional().describe('子节点数组,每个父节点2-5个子节点'),
    metadata: z
      .object({
        level: z.number().min(0).max(3).describe('层级深度 0-3'),
        chunkIds: z.array(z.string()).describe('关联的chunk ID列表'),
        keywords: z.array(z.string()).optional().describe('关键词')
      })
      .optional()
  })
)

const MindMapSchema = z.object({
  rootNode: MindMapNodeSchema.describe('根节点'),
  metadata: z.object({
    totalNodes: z.number().describe('总节点数'),
    maxDepth: z.number().describe('最大深度')
  })
})

async function getMindMapPrompt(): Promise<string> {
  const settings = await settingsManager.getAllSettings()
  const language = settings.language || 'vi-VN'
  const prompt = settings.prompts?.mindMap?.[language]
  if (!prompt) throw new Error(`未找到 ${language} 语言的思维导图提示词`)
  return prompt
}

export class MindMapService {
  constructor(private providerManager: ProviderManager) {}

  private trimChunkContent(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_CHUNK)
  }

  private async aggregateNotebookContent(notebookId: string): Promise<string> {
    const db = getDatabase()
    const contentParts: string[] = []
    const mode = getQualityMode()
    const docsLimit = mode === 'fast' ? 6 : mode === 'accurate' ? 12 : MAX_SOURCE_DOCS
    const chunksPerDoc = mode === 'fast' ? 3 : mode === 'accurate' ? 6 : MAX_CHUNKS_PER_DOC

    const docs = db
      .select({
        id: documents.id,
        title: documents.title,
        updatedAt: documents.updatedAt
      })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .orderBy(desc(documents.updatedAt))
      .limit(docsLimit)
      .all()

    Logger.info('MindMapService', `Found ${docs.length} indexed documents (mode=${mode})`)

    for (const doc of docs) {
      const docChunks = db
        .select({ id: chunks.id, content: chunks.content })
        .from(chunks)
        .where(eq(chunks.documentId, doc.id))
        .orderBy(chunks.chunkIndex)
        .limit(chunksPerDoc)
        .all()

      if (docChunks.length > 0) {
        const chunkContent = docChunks
          .map((c) => `[chunk:${c.id}] ${this.trimChunkContent(c.content)}`)
          .join('\n')
        contentParts.push(`[文档: ${doc.title}]\n${chunkContent}`)
      }
    }

    if (contentParts.length === 0) throw new Error('笔记本没有可用内容生成思维导图')

    let mergedContent = contentParts.join('\n\n---\n\n')
    if (mergedContent.length > MAX_PROMPT_CONTENT_CHARS) {
      mergedContent = mergedContent.slice(0, MAX_PROMPT_CONTENT_CHARS)
    }
    return mergedContent
  }

  private async callLLMForGeneration(
    content: string,
    onProgress?: MindMapProgressCallback
  ): Promise<MindMapGenerationResult> {
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) throw new Error('没有可用的对话模型,请先配置LLM提供商')
    if (!(provider instanceof AISDKProvider)) throw new Error('当前 provider 不支持结构化输出')

    const promptTemplate = await getMindMapPrompt()
    const model = provider.getAIModel()

    let lastError: Error | null = null
    const mode = getQualityMode()
    const maxAttempts = mode === 'accurate' ? 3 : mode === 'fast' ? 1 : 2

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const prompt =
        attempt === 1
          ? promptTemplate.replace('{{CONTENT}}', content)
          : `${promptTemplate}\n\n【修正要求】请严格输出合法JSON；所有节点id必须唯一；level必须从0开始逐层+1；每个父节点children数量为2-5；不确定时减少节点数量，优先正确性。\n\n${content}`

      try {
        onProgress?.('generating_mindmap', attempt === 1 ? 30 : 45)
        const { partialObjectStream, object } = streamObject({ model, schema: MindMapSchema, prompt })

        let lastProgress = attempt === 1 ? 30 : 45
        let chunkCount = 0
        for await (const partialObject of partialObjectStream) {
          void partialObject
          chunkCount++
          if (chunkCount % 6 === 0) {
            lastProgress = Math.min(lastProgress + 4, 68)
            onProgress?.('generating_mindmap', lastProgress)
          }
        }

        onProgress?.('parsing_result', 70)
        const result = await object
        if (!result.rootNode || !result.rootNode.id || !result.rootNode.label) {
          throw new Error('生成的思维导图格式不正确')
        }

        const chunkMapping: Record<string, string[]> = {}
        const collect = (node: MindMapTreeNode) => {
          if (node.metadata?.chunkIds?.length) chunkMapping[node.id] = node.metadata.chunkIds
          node.children?.forEach(collect)
        }
        collect(result.rootNode)

        return { rootNode: result.rootNode, chunkMapping, metadata: result.metadata }
      } catch (error) {
        lastError = error as Error
        Logger.warn(
          'MindMapService',
          `Mindmap generation attempt ${attempt} failed: ${lastError.message}`
        )
      }
    }

    throw new Error(`生成思维导图失败: ${lastError?.message || 'unknown error'}`)
  }

  private async validateAndCleanMindMap(
    notebookId: string,
    result: MindMapGenerationResult
  ): Promise<MindMapGenerationResult> {
    const db = getDatabase()

    const allChunkIds = new Set<string>()
    const collectChunkIds = (node: MindMapTreeNode) => {
      node.metadata?.chunkIds?.forEach((id) => allChunkIds.add(id))
      node.children?.forEach(collectChunkIds)
    }
    collectChunkIds(result.rootNode)

    if (allChunkIds.size > 0) {
      const validChunks = db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.notebookId, notebookId), inArray(chunks.id, Array.from(allChunkIds))))
        .all()
      const validChunkIds = new Set(validChunks.map((c) => c.id))

      const cleanNode = (node: MindMapTreeNode): MindMapTreeNode => ({
        ...node,
        metadata: node.metadata
          ? { ...node.metadata, chunkIds: (node.metadata.chunkIds || []).filter((id) => validChunkIds.has(id)) }
          : node.metadata,
        children: node.children?.map(cleanNode)
      })
      result.rootNode = cleanNode(result.rootNode)
    }

    const usedIds = new Set<string>()
    const normalizeNode = (node: MindMapTreeNode, level: number): MindMapTreeNode => {
      const baseId = (node.id || `node_${level}`).trim() || `node_${level}`
      let fixedId = baseId
      let suffix = 1
      while (usedIds.has(fixedId)) fixedId = `${baseId}_${suffix++}`
      usedIds.add(fixedId)

      const normalizedChildren = (node.children || [])
        .slice(0, 5)
        .map((child) => normalizeNode(child, Math.min(level + 1, 3)))

      return {
        id: fixedId,
        label: (node.label || '节点').trim().slice(0, 24),
        metadata: {
          ...(node.metadata || { chunkIds: [] }),
          level,
          chunkIds: node.metadata?.chunkIds || []
        },
        ...(normalizedChildren.length > 0 ? { children: normalizedChildren } : {})
      }
    }

    result.rootNode = normalizeNode(result.rootNode, 0)
    result.chunkMapping = {}
    let totalNodes = 0
    let maxDepth = 0

    const buildMapping = (node: MindMapTreeNode, depth: number) => {
      totalNodes++
      maxDepth = Math.max(maxDepth, depth)
      if (node.metadata?.chunkIds?.length) result.chunkMapping[node.id] = node.metadata.chunkIds
      node.children?.forEach((child) => buildMapping(child, depth + 1))
    }
    buildMapping(result.rootNode, 0)

    result.metadata.totalNodes = totalNodes
    result.metadata.maxDepth = maxDepth

    return result
  }

  async generateMindMap(notebookId: string, onProgress?: MindMapProgressCallback): Promise<string> {
    const db = getDatabase()
    const mindMapId = `mindmap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const startTime = Date.now()

    try {
      onProgress?.('creating_record', 0)

      const notebook = db.select().from(notebooks).where(eq(notebooks.id, notebookId)).get()
      if (!notebook) throw new Error('笔记本不存在')

      const settings = await settingsManager.getAllSettings()
      const language = settings.language || 'vi-VN'

      const latestVersion = db
        .select({ version: mindMaps.version })
        .from(mindMaps)
        .where(eq(mindMaps.notebookId, notebookId))
        .orderBy(desc(mindMaps.version))
        .limit(1)
        .get()

      const newVersion = (latestVersion?.version || 0) + 1
      const titleTemplate = language === 'en-US' ? `${notebook.title} Mind Map` : `${notebook.title}的思维导图`

      const newMindMap: NewMindMap = {
        id: mindMapId,
        notebookId,
        title: titleTemplate,
        version: newVersion,
        treeData: { id: 'root', label: '', children: [] } as never,
        chunkMapping: {} as never,
        status: 'generating',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      db.insert(mindMaps).values(newMindMap).run()

      const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      const itemId = `item-mindmap-${mindMapId}`
      db.insert(items)
        .values({
          id: itemId,
          notebookId,
          type: 'mindmap',
          resourceId: mindMapId,
          order: maxOrder + 1,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .run()

      onProgress?.('aggregating_content', 10)
      const content = await this.aggregateNotebookContent(notebookId)

      const result = await this.callLLMForGeneration(content, onProgress)

      onProgress?.('validating_data', 80)
      const validatedResult = await this.validateAndCleanMindMap(notebookId, result)

      onProgress?.('saving_mindmap', 90)
      const generationTime = Date.now() - startTime

      db.update(mindMaps)
        .set({
          treeData: validatedResult.rootNode as never,
          chunkMapping: validatedResult.chunkMapping as never,
          metadata: {
            model: (await this.providerManager.getActiveChatProvider())?.name || 'unknown',
            totalNodes: validatedResult.metadata.totalNodes,
            maxDepth: validatedResult.metadata.maxDepth,
            generationTime
          } as never,
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(mindMaps.id, mindMapId))
        .run()

      executeCheckpoint('PASSIVE')
      onProgress?.('completed', 100)
      return mindMapId
    } catch (error) {
      db.update(mindMaps)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date()
        })
        .where(eq(mindMaps.id, mindMapId))
        .run()
      throw error
    }
  }

  getMindMap(mindMapId: string): MindMap | undefined {
    const db = getDatabase()
    return db.select().from(mindMaps).where(eq(mindMaps.id, mindMapId)).get()
  }

  getLatestMindMap(notebookId: string): MindMap | undefined {
    const db = getDatabase()
    return db
      .select()
      .from(mindMaps)
      .where(and(eq(mindMaps.notebookId, notebookId), eq(mindMaps.status, 'completed')))
      .orderBy(desc(mindMaps.version))
      .limit(1)
      .get()
  }

  async getNodeChunks(
    mindMapId: string,
    nodeId: string
  ): Promise<Array<{ id: string; content: string; documentTitle: string }>> {
    const db = getDatabase()
    const mindMap = this.getMindMap(mindMapId)
    if (!mindMap) return []

    const chunkIds = (mindMap.chunkMapping as Record<string, string[]>)[nodeId] || []
    if (chunkIds.length === 0) return []

    const chunkData = db
      .select({ id: chunks.id, content: chunks.content, documentId: chunks.documentId })
      .from(chunks)
      .where(inArray(chunks.id, chunkIds))
      .all()

    const docIds = Array.from(new Set(chunkData.map((c) => c.documentId)))
    const docs = db.select().from(documents).where(inArray(documents.id, docIds)).all()
    const docMap = new Map(docs.map((d) => [d.id, d.title]))

    return chunkData.map((c) => ({
      id: c.id,
      content: c.content,
      documentTitle: docMap.get(c.documentId) || 'Unknown'
    }))
  }

  updateMindMap(mindMapId: string, updates: Partial<{ title: string }>): void {
    const db = getDatabase()
    db.update(mindMaps)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mindMaps.id, mindMapId))
      .run()
    executeCheckpoint('PASSIVE')
  }

  deleteMindMap(mindMapId: string): void {
    const db = getDatabase()
    db.delete(items).where(and(eq(items.type, 'mindmap'), eq(items.resourceId, mindMapId))).run()
    db.delete(mindMaps).where(eq(mindMaps.id, mindMapId)).run()
    executeCheckpoint('PASSIVE')
  }
}
