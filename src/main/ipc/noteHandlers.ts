import { ipcMain } from 'electron'
import { createNote, getNotesByNotebook, getNoteById, updateNote, deleteNote } from '../db/queries'
import { ProviderManager } from '../providers/ProviderManager'
import { KnowledgeService } from '../services/KnowledgeService'
import Logger from '../../shared/utils/logger'
import { NoteSchemas, validate } from './validation'

/**
 * Generate note title using AI.
 *
 * sendMessageStream trả AbortController ngay khi stream khởi động chứ KHÔNG
 * đợi stream kết thúc — vì vậy phải gói trong Promise resolve ở onComplete,
 * reject ở onError, kèm trần thời gian để không chặn tạo note vô hạn.
 */
async function generateNoteTitle(
  providerManager: ProviderManager,
  content: string
): Promise<string> {
  try {
    const provider = await providerManager.getActiveChatProvider()
    if (!provider) {
      return 'Untitled Note'
    }

    let generatedTitle = ''
    let abort: AbortController | null = null

    const streamPromise = new Promise<string>((resolve, reject) => {
      void provider
        .sendMessageStream(
          [
            {
              role: 'system',
              content:
                "You are a title generation assistant. Please generate a concise title based on the user's content, no more than 20 characters, without using quotes or other symbols to wrap it."
            },
            {
              role: 'user',
              content: `Please generate a title for the following content:\n\n${content.slice(0, 500)}`
            }
          ],
          (chunk) => {
            generatedTitle += chunk.content
          },
          (error) => {
            Logger.error('NoteHandlers', 'Failed to generate title:', error)
            reject(error)
          },
          () => {
            resolve(generatedTitle.trim() || 'Untitled Note')
          }
        )
        .then((controller) => {
          abort = controller
        })
        .catch((error) => {
          Logger.error('NoteHandlers', 'Title stream failed to start:', error)
          reject(error)
        })
    })

    const timeout = new Promise<string>((resolve) =>
      setTimeout(() => {
        Logger.warn('NoteHandlers', 'Title generation timed out, using fallback')
        abort?.abort()
        resolve(generatedTitle.trim() || 'Untitled Note')
      }, 15000)
    )

    return await Promise.race([streamPromise, timeout])
  } catch (error) {
    Logger.error('NoteHandlers', 'Error in generateNoteTitle:', error)
    return 'Untitled Note'
  }
}

/**
 * Register note-related IPC handlers
 */
export function registerNoteHandlers(
  providerManager: ProviderManager,
  knowledgeService: KnowledgeService
) {
  // Create note (with argument validation)
  ipcMain.handle(
    'create-note',
    validate(NoteSchemas.createNote, async (args) => {
      Logger.debug('NoteHandlers', 'create-note:', {
        notebookId: args.notebookId,
        hasCustomTitle: !!args.title
      })

      try {
        // If no title provided (empty string), use AI to generate
        const title = args.title || (await generateNoteTitle(providerManager, args.content))
        const note = createNote(args.notebookId, title, args.content)
        Logger.debug('NoteHandlers', 'Note created successfully:', note.id)
        return note
      } catch (error) {
        Logger.error('NoteHandlers', 'Error creating note:', error)
        throw error
      }
    })
  )

  // Get all notes in notebook (with argument validation)
  ipcMain.handle(
    'get-notes',
    validate(NoteSchemas.getNotes, async (args) => {
      Logger.debug('NoteHandlers', 'get-notes:', args.notebookId)
      try {
        const notes = getNotesByNotebook(args.notebookId)
        Logger.debug('NoteHandlers', `Retrieved ${notes.length} notes`)
        return notes
      } catch (error) {
        Logger.error('NoteHandlers', 'Error getting notes:', error)
        throw error
      }
    })
  )

  // Get single note (with argument validation)
  ipcMain.handle(
    'get-note',
    validate(NoteSchemas.getNote, async (args) => {
      Logger.debug('NoteHandlers', 'get-note:', args.id)
      try {
        const note = getNoteById(args.id)
        return note
      } catch (error) {
        Logger.error('NoteHandlers', 'Error getting note:', error)
        throw error
      }
    })
  )

  // Update note (with argument validation)
  ipcMain.handle(
    'update-note',
    validate(NoteSchemas.updateNote, async (args) => {
      Logger.debug('NoteHandlers', 'update-note:', { id: args.id, updates: args.updates })
      try {
        updateNote(args.id, args.updates)
        Logger.debug('NoteHandlers', 'Note updated successfully:', args.id)
        // Auto-sync: note đã vào KB thì tự reindex incremental
        void knowledgeService.syncNoteToKnowledge(args.id).catch((error) => {
          Logger.error('NoteHandlers', 'Auto-sync note to KB failed:', error)
        })
        return { success: true }
      } catch (error) {
        Logger.error('NoteHandlers', 'Error updating note:', error)
        throw error
      }
    })
  )

  // Delete note (with argument validation)
  ipcMain.handle(
    'delete-note',
    validate(NoteSchemas.deleteNote, async (args) => {
      Logger.debug('NoteHandlers', 'delete-note:', args.id)
      try {
        // Xóa KB docs liên kết trước khi xóa note (tránh mồ côi)
        await knowledgeService.deleteDocumentsBySourceNote(args.id)
        deleteNote(args.id)
        Logger.debug('NoteHandlers', 'Note deleted successfully:', args.id)
        return { success: true }
      } catch (error) {
        Logger.error('NoteHandlers', 'Error deleting note:', error)
        throw error
      }
    })
  )
}
