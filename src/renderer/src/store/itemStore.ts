import { create } from 'zustand'
import type { Note } from '../../../shared/types'
import type { Quiz } from '../../../main/db/schema'

/**
 * Item type
 */
export type ItemType = 'note' | 'quiz' | 'ppt' | 'audio' | 'video'

/**
 * Item details
 */
export interface ItemDetail {
  id: string
  notebookId: string
  type: ItemType
  resourceId: string
  order: number
  createdAt: Date
  updatedAt: Date
  resource: Note | Quiz | null // Underlying resource data
}

/**
 * Derive the notes array from the items array
 * Extracted into a helper to keep the logic consistent
 */
const deriveNotes = (items: ItemDetail[]): Note[] => {
  return items.filter((item) => item.type === 'note').map((item) => item.resource as Note)
}

interface ItemStore {
  // State
  items: ItemDetail[]
  notes: Note[] // Derived state: items from the list where type === 'note'
  currentNote: Note | null
  isEditing: boolean
  isSaving: boolean

  // Actions
  setItems: (items: ItemDetail[]) => void
  setCurrentNote: (note: Note | null) => void
  setIsEditing: (isEditing: boolean) => void

  // Async operations
  loadItems: (notebookId: string) => Promise<void>
  loadNotes: (notebookId: string) => Promise<void>
  createNote: (notebookId: string, content: string, customTitle?: string) => Promise<Note>
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => Promise<void>
  deleteItem: (itemId: string, deleteResource: boolean) => Promise<void>
}

export const useItemStore = create<ItemStore>()((set, get) => ({
  items: [],
  notes: [],
  currentNote: null,
  isEditing: false,
  isSaving: false,

  setItems: (items) => set({ items }),
  setCurrentNote: (note) => set({ currentNote: note, isEditing: !!note }),
  setIsEditing: (isEditing) => set({ isEditing }),

  loadItems: async (notebookId: string) => {
    console.log('[ItemStore] Loading items for notebook:', notebookId)
    try {
      const items = await window.api.items.getAll(notebookId)
      console.log(`[ItemStore] Loaded ${items.length} items`)

      // Derive the notes list
      const notes = deriveNotes(items)

      set({ items, notes })
    } catch (error) {
      console.error('[ItemStore] Failed to load items:', error)
      throw error
    }
  },

  loadNotes: async (notebookId: string) => {
    // loadNotes actually calls loadItems because notes are derived from items
    await get().loadItems(notebookId)
  },

  createNote: async (notebookId: string, content: string, customTitle?: string) => {
    console.log('[ItemStore] Creating note')
    try {
      set({ isSaving: true })
      const note = await window.api.createNote(notebookId, content, customTitle)
      console.log('[ItemStore] Note created:', note.id)

      // Reload the items list
      await get().loadItems(notebookId)

      set({
        currentNote: note,
        isEditing: true,
        isSaving: false
      })

      return note
    } catch (error) {
      console.error('[ItemStore] Failed to create note:', error)
      set({ isSaving: false })
      throw error
    }
  },

  updateNote: async (id: string, updates: Partial<Pick<Note, 'title' | 'content'>>) => {
    console.log('[ItemStore] Updating note:', id)
    try {
      set({ isSaving: true })
      await window.api.updateNote(id, updates)
      console.log('[ItemStore] Note updated:', id)

      set((state) => {
        const updatedItems = state.items.map((item) => {
          if (item.type === 'note' && item.resourceId === id) {
            return {
              ...item,
              resource: { ...(item.resource as Note), ...updates, updatedAt: new Date() },
              updatedAt: new Date()
            }
          }
          return item
        })

        // Re-derive the notes array to keep it in sync with items
        const notes = deriveNotes(updatedItems)

        const updatedCurrentNote =
          state.currentNote?.id === id
            ? { ...state.currentNote, ...updates, updatedAt: new Date() }
            : state.currentNote

        return {
          items: updatedItems,
          notes,
          currentNote: updatedCurrentNote,
          isSaving: false
        }
      })
    } catch (error) {
      console.error('[ItemStore] Failed to update note:', error)
      set({ isSaving: false })
      throw error
    }
  },

  deleteItem: async (itemId: string, deleteResource = true) => {
    console.log('[ItemStore] Deleting item:', itemId)
    try {
      await window.api.items.delete(itemId, deleteResource)
      console.log('[ItemStore] Item deleted:', itemId)

      set((state) => {
        const deletedItem = state.items.find((item) => item.id === itemId)
        const isCurrentNote =
          deletedItem?.type === 'note' && state.currentNote?.id === deletedItem.resourceId

        const updatedItems = state.items.filter((item) => item.id !== itemId)
        // Re-derive the notes array to keep it in sync with items
        const notes = deriveNotes(updatedItems)

        return {
          items: updatedItems,
          notes,
          currentNote: isCurrentNote ? null : state.currentNote,
          isEditing: isCurrentNote ? false : state.isEditing
        }
      })
    } catch (error) {
      console.error('[ItemStore] Failed to delete item:', error)
      throw error
    }
  }
}))
