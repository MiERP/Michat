import { getDatabase } from '../db'
import { items, notes, mindMaps, quizzes, podcastScripts, type Item, type NewItem } from '../db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { randomUUID } from 'crypto'

/**
 */
export type ItemType = 'note' | 'mindmap' | 'quiz' | 'ppt' | 'audio' | 'video'

/**
 */
export interface ItemDetail extends Item {
  resource: any // 根据 type 返回对应的资源数据（Note | MindMap | ...）
}

/**
 */
export class ItemService {
  /**
   */
  async getItemsByNotebook(notebookId: string): Promise<ItemDetail[]> {
    const db = getDatabase()
    const itemsList = await db
      .select()
      .from(items)
      .where(eq(items.notebookId, notebookId))
      .orderBy(items.order)

    // Batch load resources by type
    const noteIds = itemsList.filter(i => i.type === 'note').map(i => i.resourceId)
    const mindMapIds = itemsList.filter(i => i.type === 'mindmap').map(i => i.resourceId)
    const quizIds = itemsList.filter(i => i.type === 'quiz').map(i => i.resourceId)
    const audioIds = itemsList.filter(i => i.type === 'audio').map(i => i.resourceId)

    const [noteRows, mindMapRows, quizRows, audioRows] = await Promise.all([
      noteIds.length > 0 ? db.select().from(notes).where(inArray(notes.id, noteIds)) : Promise.resolve([]),
      mindMapIds.length > 0 ? db.select().from(mindMaps).where(inArray(mindMaps.id, mindMapIds)) : Promise.resolve([]),
      quizIds.length > 0 ? db.select().from(quizzes).where(inArray(quizzes.id, quizIds)) : Promise.resolve([]),
      audioIds.length > 0 ? db.select().from(podcastScripts).where(inArray(podcastScripts.id, audioIds)) : Promise.resolve([])
    ])

    const noteMap = new Map<string, any>()
    for (const r of noteRows) noteMap.set(r.id, r)
    const mindMapMap = new Map<string, any>()
    for (const r of mindMapRows) mindMapMap.set(r.id, r)
    const quizMap = new Map<string, any>()
    for (const r of quizRows) quizMap.set(r.id, r)
    const audioMap = new Map<string, any>()
    for (const r of audioRows) audioMap.set(r.id, r)

    const itemDetails: ItemDetail[] = []
    for (const item of itemsList) {
      let resource: any = null
      switch (item.type) {
        case 'note': resource = noteMap.get(item.resourceId) || null; break
        case 'mindmap': resource = mindMapMap.get(item.resourceId) || null; break
        case 'quiz': resource = quizMap.get(item.resourceId) || null; break
        case 'audio': resource = audioMap.get(item.resourceId) || null; break
      }
      if (resource) {
        itemDetails.push({ ...item, resource })
      }
    }

    return itemDetails
  }

  /**
   */
  async createItem(data: {
    notebookId: string
    type: ItemType
    resourceId: string
    order?: number
  }): Promise<Item> {
    const db = getDatabase()
    const now = new Date()

    let order = data.order
    if (order === undefined) {
      const existingItems = await db
        .select()
        .from(items)
        .where(eq(items.notebookId, data.notebookId))

      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      order = maxOrder + 1
    }

    const newItem: NewItem = {
      id: randomUUID(),
      notebookId: data.notebookId,
      type: data.type,
      resourceId: data.resourceId,
      order,
      createdAt: now,
      updatedAt: now
    }

    await db.insert(items).values(newItem)
    return newItem as Item
  }

  /**
   */
  async deleteItem(itemId: string): Promise<void> {
    const db = getDatabase()
    await db.delete(items).where(eq(items.id, itemId))
  }

  /**
   */
  async updateItemOrder(itemId: string, order: number): Promise<void> {
    const db = getDatabase()
    await db.update(items).set({ order, updatedAt: new Date() }).where(eq(items.id, itemId))
  }

  /**
   */
  async batchUpdateOrder(updates: Record<string, number>): Promise<void> {
    const db = getDatabase()
    const now = new Date()
    for (const [itemId, order] of Object.entries(updates)) {
      await db.update(items).set({ order, updatedAt: now }).where(eq(items.id, itemId))
    }
  }

  /**
   */
  async findItemByResource(resourceId: string, type: ItemType): Promise<Item | null> {
    const db = getDatabase()
    const result = await db
      .select()
      .from(items)
      .where(and(eq(items.resourceId, resourceId), eq(items.type, type)))
      .limit(1)

    return result[0] || null
  }

  /**
   */
  async deleteItemWithResource(itemId: string): Promise<void> {
    const db = getDatabase()
    const item = await db.select().from(items).where(eq(items.id, itemId)).limit(1)

    if (!item[0]) {
      throw new Error('Item not found')
    }

    const { type, resourceId } = item[0]

    switch (type) {
      case 'note':
        await db.delete(notes).where(eq(notes.id, resourceId))
        break
      case 'mindmap':
        await db.delete(mindMaps).where(eq(mindMaps.id, resourceId))
        break
      case 'quiz':
        await db.delete(quizzes).where(eq(quizzes.id, resourceId))
        break
      case 'audio':
        await db.delete(podcastScripts).where(eq(podcastScripts.id, resourceId))
        break
    }

    await db.delete(items).where(eq(items.id, itemId))
  }
}

export const itemService = new ItemService()
