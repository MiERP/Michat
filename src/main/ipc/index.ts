import { ProviderManager } from '../providers/ProviderManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { BackgroundJobService } from '../services/BackgroundJobService'
import { UpdateService } from '../services/UpdateService'
import { QuizService } from '../services/QuizService'
import { ShortcutManager } from '../services/ShortcutManager'
import { LlamaService } from '../services/LlamaService'
import type Store from 'electron-store'
import type { StoreSchema } from '../config/types'
import { registerChatHandlers } from './chatHandlers'
import { registerProviderHandlers } from './providerHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerNotebookHandlers } from './notebookHandlers'
import { registerNoteHandlers } from './noteHandlers'
import { registerKnowledgeHandlers } from './knowledgeHandlers'
import { registerQuizHandlers } from './quizHandlers'
import { registerUpdateHandlers } from './updateHandlers'
import { registerItemHandlers } from './itemHandlers'
import { registerShortcutHandlers } from './shortcutHandlers'
import { registerLlamaHandlers } from './llamaHandlers'
import { registerLicenseHandlers } from './licenseHandlers'
import type { NotebookSummaryService } from '../services/NotebookSummaryService'

/**
 * 注册所有 IPC Handlers
 */
export function registerAllHandlers(
  providerManager: ProviderManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService,
  updateService: UpdateService,
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>,
  llamaService: LlamaService,
  backgroundJobService: BackgroundJobService,
  notebookSummaryService: NotebookSummaryService
) {
  // 实例化 QuizService
  const quizService = new QuizService(
    providerManager,
    knowledgeService,
    () => llamaService.getRuntimeInfo().chatCtxSize
  )

  registerChatHandlers(providerManager, sessionAutoSwitchService, knowledgeService, llamaService)
  registerProviderHandlers(providerManager, llamaService)
  registerSettingsHandlers()
  registerNotebookHandlers()
  registerNoteHandlers(providerManager, knowledgeService)
  registerKnowledgeHandlers(
    providerManager,
    knowledgeService,
    llamaService,
    backgroundJobService,
    notebookSummaryService
  )
  registerQuizHandlers(quizService)
  registerUpdateHandlers(updateService)
  registerItemHandlers(knowledgeService)
  registerShortcutHandlers(shortcutManager, store)
  registerLlamaHandlers(llamaService)
  registerLicenseHandlers()
  console.log('[IPC] All handlers registered')
}

export {
  registerChatHandlers,
  registerProviderHandlers,
  registerSettingsHandlers,
  registerNotebookHandlers,
  registerNoteHandlers,
  registerKnowledgeHandlers,
  registerQuizHandlers,
  registerLicenseHandlers
}
