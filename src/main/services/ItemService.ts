import { getDatabase } from '../db'
import { items, notes, quizzes, type Item, type NewItem } from '../db/schema'
import type { Note, Quiz } from '../db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { randomUUID } from 'crypto'

/**
 * Item type enum
 */
export type ItemType = 'note' | 'quiz' | 'ppt' | 'audio' | 'video'

/**
 * Resource attached to an item. Unknown item types have no resource loaded.
 */
export type ItemResource = Note | Quiz | null

/**
 * Item detail (includes associated resource data)
 */
export interface ItemDetail extends Item {
  resource: ItemResource // Resource data corresponding to type (Note | Quiz | ...)
}

/**
 * Item service
 * Manages all content items under a notebook
 */
export class ItemService {
  /**
   * Get all items in a notebook (with associated resources)
   * Sorted by order ascending
   */
  async getItemsByNotebook(notebookId: string): Promise<ItemDetail[]> {
    const db = getDatabase()
    const itemsList = await db
      .select()
      .from(items)
      .where(eq(items.notebookId, notebookId))
      .orderBy(items.order)

    // Batch load resources by type
    const noteIds = itemsList.filter((i) => i.type === 'note').map((i) => i.resourceId)
    const quizIds = itemsList.filter((i) => i.type === 'quiz').map((i) => i.resourceId)

    const [noteRows, quizRows] = await Promise.all([
      noteIds.length > 0
        ? db.select().from(notes).where(inArray(notes.id, noteIds))
        : Promise.resolve([]),
      quizIds.length > 0
        ? db.select().from(quizzes).where(inArray(quizzes.id, quizIds))
        : Promise.resolve([])
    ])

    const noteMap = new Map<string, Note>()
    for (const r of noteRows) noteMap.set(r.id, r)
    const quizMap = new Map<string, Quiz>()
    for (const r of quizRows) quizMap.set(r.id, r)

    const itemDetails: ItemDetail[] = []
    for (const item of itemsList) {
      let resource: ItemResource = null
      switch (item.type) {
        case 'note':
          resource = noteMap.get(item.resourceId) || null
          break
        case 'quiz':
          resource = quizMap.get(item.resourceId) || null
          break
      }
      if (resource) {
        itemDetails.push({ ...item, resource })
      }
    }

    return itemDetails
  }

  /**
   * Create an item (automatically appended to the end of the list)
   */
  async createItem(data: {
    notebookId: string
    type: ItemType
    resourceId: string
    order?: number
  }): Promise<Item> {
    const db = getDatabase()
    const now = new Date()

    // If order is not specified, get the maximum order value in the notebook
    let order = data.order
    if (order === undefined) {
      const existingItems = await db
        .select()
        .from(items)
        .where(eq(items.notebookId, data.notebookId))

      // Find the max order; the new item's order is max + 1
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
   * Delete an item (does not delete the associated resource)
   */
  async deleteItem(itemId: string): Promise<void> {
    const db = getDatabase()
    await db.delete(items).where(eq(items.id, itemId))
  }

  /**
   * Update an item's order
   */
  async updateItemOrder(itemId: string, order: number): Promise<void> {
    const db = getDatabase()
    await db.update(items).set({ order, updatedAt: new Date() }).where(eq(items.id, itemId))
  }

  /**
   * Batch update item order
   * @param updates - Mapping of { itemId: order }
   */
  async batchUpdateOrder(updates: Record<string, number>): Promise<void> {
    const db = getDatabase()
    const now = new Date()
    for (const [itemId, order] of Object.entries(updates)) {
      await db.update(items).set({ order, updatedAt: now }).where(eq(items.id, itemId))
    }
  }

  /**
   * Find an item by resource ID and type
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
   * Get an item by ID
   */
  async getItemById(itemId: string): Promise<Item | null> {
    const db = getDatabase()
    const result = await db.select().from(items).where(eq(items.id, itemId)).limit(1)
    return result[0] || null
  }

  /**
   * Delete the associated resource and item
   */
  async deleteItemWithResource(itemId: string): Promise<void> {
    const db = getDatabase()
    const item = await db.select().from(items).where(eq(items.id, itemId)).limit(1)

    if (!item[0]) {
      throw new Error('Item not found')
    }

    const { type, resourceId } = item[0]

    // Delete the associated resource
    switch (type) {
      case 'note':
        await db.delete(notes).where(eq(notes.id, resourceId))
        break
      case 'quiz':
        await db.delete(quizzes).where(eq(quizzes.id, resourceId))
        break
      // More types can be added in the future
    }

    // Delete the item (it may already be gone if the resource cascades)
    await db.delete(items).where(eq(items.id, itemId))
  }
}

export const itemService = new ItemService()
