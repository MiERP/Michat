import { useEffect, useCallback, ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import TopNavigationBar from '../common/TopNavigationBar'
import ResizableLayout from '../layouts/ResizableLayout'
import SourcePanel from './SourcePanel'
import ProcessPanel from './ProcessPanel'
import NotePanel from './NotePanel'
import { useNotebookStore } from '../../store/notebookStore'
import { useChatStore } from '../../store/chatStore'
import { setupQuizListeners } from '../../store/quizStore'

export default function NotebookLayout(): ReactElement {
  const { t } = useTranslation('ui')
  const navigate = useNavigate()
  const { id } = useParams()
  const { notebooks, addNotebook, addOpenedNotebook, setCurrentNotebook, removeOpenedNotebook } =
    useNotebookStore()
  const { loadActiveSession } = useChatStore()

  // When entering a notebook, set openedNotebook and currentNotebook and load the top session
  useEffect(() => {
    if (id) {
      addOpenedNotebook(id)
      setCurrentNotebook(id)
      // Key change: automatically load the top session for this notebook
      loadActiveSession(id).catch((err) => {
        console.error('[NotebookLayout] Failed to load session for notebook:', id, err)
      })
    }
  }, [id, addOpenedNotebook, setCurrentNotebook, loadActiveSession])

  const handleCreateNotebook = useCallback(async (): Promise<void> => {
    const newId = await addNotebook({
      title: t('newNotebook', { index: notebooks.length + 1 }),
      description: t('notebookDescription')
    })

    navigate(`/notebook/${newId}`)
  }, [addNotebook, t, notebooks.length, navigate])

  // Listen for notebook management shortcuts
  useEffect(() => {
    const handleCreateShortcut = () => {
      void handleCreateNotebook()
    }

    const handleCloseShortcut = () => {
      // Close the current notebook tab and return to the notebook list
      if (id) {
        removeOpenedNotebook(id)
      }
      navigate('/')
    }

    window.addEventListener('shortcut:create-notebook', handleCreateShortcut)
    window.addEventListener('shortcut:close-notebook', handleCloseShortcut)

    return () => {
      window.removeEventListener('shortcut:create-notebook', handleCreateShortcut)
      window.removeEventListener('shortcut:close-notebook', handleCloseShortcut)
    }
  }, [navigate, handleCreateNotebook, id, removeOpenedNotebook])

  // Set up quiz progress listeners
  useEffect(() => {
    const cleanup = setupQuizListeners()
    return cleanup
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopNavigationBar onCreateClick={handleCreateNotebook} />

      <ResizableLayout
        leftPanel={<SourcePanel />}
        centerPanel={<ProcessPanel />}
        rightPanel={<NotePanel />}
      />
    </div>
  )
}
