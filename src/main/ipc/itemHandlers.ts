import { ipcMain } from 'electron'
import { itemService } from '../services/ItemService'
import type { KnowledgeService } from '../services/KnowledgeService'
import Logger from '../../shared/utils/logger'
import { z } from 'zod'
import { validate } from './validation'

/**
 * Item-related validation schemas
 */
const ItemSchemas = {
  getItems: z.object({
    notebookId: z.string()
  }),
  updateOrder: z.object({
    itemId: z.string(),
    order: z.number()
  }),
  batchUpdateOrder: z.object({
    updates: z.record(z.string(), z.number())
  }),
  deleteItem: z.object({
    itemId: z.string(),
    deleteResource: z.boolean().optional()
  })
}

/**
 * Registers the item IPC handlers
 */
export function registerItemHandlers(knowledgeService: KnowledgeService) {
  // Get all items in a notebook
  ipcMain.handle(
    'items:get',
    validate(ItemSchemas.getItems, async (args) => {
      Logger.debug('ItemHandlers', 'items:get:', args.notebookId)
      try {
        const items = await itemService.getItemsByNotebook(args.notebookId)
        Logger.debug('ItemHandlers', `Retrieved ${items.length} items`)
        return items
      } catch (error) {
        Logger.error('ItemHandlers', 'Error getting items:', error)
        throw error
      }
    })
  )

  // Update the item order
  ipcMain.handle(
    'items:update-order',
    validate(ItemSchemas.updateOrder, async (args) => {
      Logger.debug('ItemHandlers', 'items:update-order:', args)
      try {
        await itemService.updateItemOrder(args.itemId, args.order)
        return { success: true }
      } catch (error) {
        Logger.error('ItemHandlers', 'Error updating item order:', error)
        throw error
      }
    })
  )

  // Update the order of multiple items in bulk
  ipcMain.handle(
    'items:batch-update-order',
    validate(ItemSchemas.batchUpdateOrder, async (args) => {
      Logger.debug('ItemHandlers', 'items:batch-update-order:', {
        count: Object.keys(args.updates).length
      })
      try {
        await itemService.batchUpdateOrder(args.updates)
        return { success: true }
      } catch (error) {
        Logger.error('ItemHandlers', 'Error batch updating order:', error)
        throw error
      }
    })
  )

  // Delete an item (optionally deleting the associated resource)
  ipcMain.handle(
    'items:delete',
    validate(ItemSchemas.deleteItem, async (args) => {
      Logger.debug('ItemHandlers', 'items:delete:', args)
      try {
        if (args.deleteResource) {
          // Phải dọn KB document TRƯỚC khi xoá note: FK documents.sourceNoteId
          // là ON DELETE SET NULL, nên xoá note sẽ làm mất liên kết và bước dọn
          // sau đó không còn tìm thấy document nào (bug trước đây).
          const item = await itemService.getItemById(args.itemId)
          if (item?.type === 'note') {
            await knowledgeService.deleteDocumentsBySourceNote(item.resourceId)
          }
          await itemService.deleteItemWithResource(args.itemId)
        } else {
          await itemService.deleteItem(args.itemId)
        }
        return { success: true }
      } catch (error) {
        Logger.error('ItemHandlers', 'Error deleting item:', error)
        throw error
      }
    })
  )
}
