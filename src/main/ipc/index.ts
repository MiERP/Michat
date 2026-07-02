import { ProviderManager } from '../providers/ProviderManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { UpdateService } from '../services/UpdateService'
import { MindMapService } from '../services/MindMapService'
import { QuizService } from '../services/QuizService'
import { PodcastService } from '../services/PodcastService'
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
import { registerMindMapHandlers } from './mindmapHandlers'
import { registerQuizHandlers } from './quizHandlers'
import { registerPodcastHandlers } from './podcastHandlers'
import { registerUpdateHandlers } from './updateHandlers'
import { registerItemHandlers } from './itemHandlers'
import { registerShortcutHandlers } from './shortcutHandlers'
import { registerLlamaHandlers } from './llamaHandlers'
import { registerLicenseHandlers } from './licenseHandlers'
import { registerTemplateHandlers } from './templateHandlers'

/**
 * æ³¨å†Œæ‰€æœ‰ IPC Handlers
 */
export function registerAllHandlers(
  providerManager: ProviderManager,
  sessionAutoSwitchService: SessionAutoSwitchService,
  knowledgeService: KnowledgeService,
  updateService: UpdateService,
  shortcutManager: ShortcutManager,
  store: Store<StoreSchema>,
  llamaService: LlamaService
) {
  // å®žä¾‹åŒ– MindMapService
  const mindMapService = new MindMapService(providerManager)
  // å®žä¾‹åŒ– QuizService
  const quizService = new QuizService(providerManager)
  const podcastService = new PodcastService(providerManager)

  registerChatHandlers(providerManager, sessionAutoSwitchService, knowledgeService, llamaService)
  registerProviderHandlers(providerManager, llamaService)
  registerSettingsHandlers()
  registerNotebookHandlers()
  registerNoteHandlers(providerManager)
  registerKnowledgeHandlers(knowledgeService, llamaService)
  registerMindMapHandlers(mindMapService)
  registerQuizHandlers(quizService)
  registerPodcastHandlers(podcastService)
  registerUpdateHandlers(updateService)
  registerItemHandlers()
  registerShortcutHandlers(shortcutManager, store)
  registerLlamaHandlers(llamaService)
  registerLicenseHandlers()
  registerTemplateHandlers()
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
  registerPodcastHandlers,
  registerLicenseHandlers,
  registerTemplateHandlers
}
