import { ProviderManager } from '../providers/ProviderManager'
import { SessionAutoSwitchService } from '../services/SessionAutoSwitchService'
import { KnowledgeService } from '../services/KnowledgeService'
import { UpdateService } from '../services/UpdateService'
import { MindMapService } from '../services/MindMapService'
import { QuizService } from '../services/QuizService'
import { ShortcutManager } from '../services/ShortcutManager'
import { LlamaService } from '../services/LlamaService'
import { ToolRegistry } from '../services/ToolRegistry'
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
import { registerUpdateHandlers } from './updateHandlers'
import { registerItemHandlers } from './itemHandlers'
import { registerShortcutHandlers } from './shortcutHandlers'
import { registerLlamaHandlers } from './llamaHandlers'
import { registerLicenseHandlers } from './licenseHandlers'
import { registerTemplateHandlers } from './templateHandlers'
import { registerOfficeHandlers } from './officeHandlers'
import { OfficeBridgeService } from '../services/office/OfficeBridgeService'

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
  officeBridgeService: OfficeBridgeService
) {
  // 实例化 MindMapService
  const mindMapService = new MindMapService(providerManager)
  const quizService = new QuizService(providerManager)
  const toolRegistry = new ToolRegistry()

  registerChatHandlers(
    providerManager,
    sessionAutoSwitchService,
    knowledgeService,
    llamaService,
    toolRegistry
  )
  registerProviderHandlers(providerManager, llamaService)
  registerSettingsHandlers()
  registerNotebookHandlers()
  registerNoteHandlers(providerManager)
  registerKnowledgeHandlers(knowledgeService, llamaService)
  registerMindMapHandlers(mindMapService)
  registerQuizHandlers(quizService)
  registerUpdateHandlers(updateService)
  registerItemHandlers()
  registerShortcutHandlers(shortcutManager, store)
  registerLlamaHandlers(llamaService)
  registerLicenseHandlers()
  registerTemplateHandlers()
  registerOfficeHandlers(officeBridgeService)
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
  registerLicenseHandlers,
  registerTemplateHandlers
}
