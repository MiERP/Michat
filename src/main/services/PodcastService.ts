import { generateText } from 'ai'
import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { getDatabase } from '../db'
import { chunks, documents, items, podcastScripts } from '../db/schema'
import { ProviderManager } from '../providers/ProviderManager'
import { AISDKProvider } from '../providers/base/AISDKProvider'

const MAX_SOURCE_DOCS = 8
const MAX_CHUNKS_PER_DOC = 4
const MAX_CHARS_PER_CHUNK = 900
const MAX_PROMPT_CONTENT_CHARS = 24000

export interface PodcastScriptResult {
  id: string
  title: string
  script: string
}

export class PodcastService {
  constructor(private providerManager: ProviderManager) {}

  async generateScript(
    notebookId: string,
    options: { signal?: AbortSignal; onProgress?: (stage: string, progress: number) => void } = {}
  ): Promise<PodcastScriptResult> {
    options.signal?.throwIfAborted()
    options.onProgress?.('aggregating_content', 10)
    const content = this.aggregateNotebookContent(notebookId)
    const provider = await this.providerManager.getActiveChatProvider()
    if (!provider) throw new Error('No chat model configured')
    if (!(provider instanceof AISDKProvider)) throw new Error('Current provider does not support generation')

    options.signal?.throwIfAborted()
    options.onProgress?.('generating_script', 30)

    const { text } = await generateText({
      model: provider.getAIModel(),
      abortSignal: options.signal,
      prompt: `Create a Vietnamese podcast script from the notebook content below. Output only the script. Include a clear title, intro, 3-5 sections, speaker-friendly transitions, and outro. Do not invent facts not supported by content.\n\n${content}`
    })

    options.signal?.throwIfAborted()
    options.onProgress?.('saving_script', 90)

    const script = text.trim()
    if (!script) throw new Error('Podcast script generation returned empty text')

    const title = script.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 120) || 'Podcast script'
    const id = this.saveScript(notebookId, title, script)
    options.onProgress?.('completed', 100)

    return { id, title, script }
  }

  async synthesizeAudio(): Promise<never> {
    throw new Error('Podcast audio is not implemented yet. Configure local TTS in a later step.')
  }

  private saveScript(notebookId: string, title: string, script: string): string {
    const db = getDatabase()
    const now = new Date()
    const id = `podcast-${randomUUID()}`

    db.insert(podcastScripts)
      .values({
        id,
        notebookId,
        title,
        script,
        status: 'script_ready',
        createdAt: now,
        updatedAt: now
      })
      .run()

    const existingItems = db.select().from(items).where(eq(items.notebookId, notebookId)).all()
    const nextOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1) + 1

    db.insert(items)
      .values({
        id: `item-podcast-${id}`,
        notebookId,
        type: 'audio',
        resourceId: id,
        order: nextOrder,
        createdAt: now,
        updatedAt: now
      })
      .run()

    return id
  }

  updateTitle(id: string, title: string): void {
    getDatabase()
      .update(podcastScripts)
      .set({ title, updatedAt: new Date() })
      .where(eq(podcastScripts.id, id))
      .run()
  }

  private aggregateNotebookContent(notebookId: string): string {
    const db = getDatabase()
    const docs = db
      .select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt })
      .from(documents)
      .where(and(eq(documents.notebookId, notebookId), eq(documents.status, 'indexed')))
      .orderBy(desc(documents.updatedAt))
      .limit(MAX_SOURCE_DOCS)
      .all()

    const parts: string[] = []
    for (const doc of docs) {
      const docChunks = db
        .select({ content: chunks.content })
        .from(chunks)
        .where(eq(chunks.documentId, doc.id))
        .orderBy(chunks.chunkIndex)
        .limit(MAX_CHUNKS_PER_DOC)
        .all()

      if (docChunks.length) {
        parts.push(`[${doc.title}]\n${docChunks.map((chunk) => this.trim(chunk.content)).join('\n')}`)
      }
    }

    if (!parts.length) throw new Error('Notebook has no indexed content for podcast script')
    return parts.join('\n\n---\n\n').slice(0, MAX_PROMPT_CONTENT_CHARS)
  }

  private trim(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_CHUNK)
  }
}
