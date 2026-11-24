import type { ApiClient } from '../ai/apiClient'
import type { ApiConfigManager } from '../ai/apiConfigManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { BackgroundJobService } from '../services/BackgroundJobService'
import { UpdateService } from '../services/UpdateService'
import { QuizService } from '../services/QuizService'
import { ShortcutManager } from '../services/ShortcutManager'
import type Store from 'electron-store'
import type { StoreSchema } from '../config/types'
import { registerChatHandlers } from './chatHandlers'
import { registerApiHandlers } from './apiHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerNotebookHandlers } from './notebookHandlers'
import { registerNoteHandlers } from './noteHandlers'
import { registerKnowledgeHandlers } from './knowledgeHandlers'
import { registerQuizHandlers } from './quizHandlers'
import { registerUpdateHandlers } from './updateHandlers'
import { registerItemHandlers } from './itemHandlers'
import { registerShortcutHandlers } from './shortcutHandlers'
import type { NotebookSummaryService } from '../services/NotebookSummaryService'

/**
 * Registers all IPC handlers
 */
export function registerAllHandlers(
  apiClient: ApiClient,
  apiConfigManager: ApiConfigManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService,
  updateService: UpdateService,
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>,
  backgroundJobService: BackgroundJobService,
  notebookSummaryService: NotebookSummaryService
) {
  const quizService = new QuizService(apiClient, knowledgeService, () =>
    apiConfigManager.getContextWindowSync()
  )

  registerChatHandlers(apiClient, sessionAutoSwitchService, knowledgeService)
  registerApiHandlers(apiClient, apiConfigManager)
  registerSettingsHandlers()
  registerNotebookHandlers()
  registerNoteHandlers(apiClient, knowledgeService)
  registerKnowledgeHandlers(
    apiClient,
    knowledgeService,
    backgroundJobService,
    notebookSummaryService
  )
  registerQuizHandlers(quizService)
  registerUpdateHandlers(updateService)
  registerItemHandlers(knowledgeService)
  registerShortcutHandlers(shortcutManager, store)
  console.log('[IPC] All handlers registered')
}

export {
  registerChatHandlers,
  registerApiHandlers,
  registerSettingsHandlers,
  registerNotebookHandlers,
  registerNoteHandlers,
  registerKnowledgeHandlers,
  registerQuizHandlers
}
