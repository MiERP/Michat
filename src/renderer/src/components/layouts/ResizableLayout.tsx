import { useEffect, useCallback, ReactNode, ReactElement } from 'react'
import * as React from 'react'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { usePanelRef } from 'react-resizable-panels'

export interface ResizableLayoutProps {
  leftPanel: ReactNode
  centerPanel: ReactNode
  rightPanel: ReactNode
  defaultLeftWidth?: number
  defaultRightWidth?: number
  minLeftWidth?: number
  minRightWidth?: number
  minCenterWidth?: number
}

/** Props injected into the center panel by the layout. */
interface CenterPanelInjectedProps {
  onToggleLeft: () => void
  onToggleRight: () => void
  isLeftCollapsed: boolean
  isRightCollapsed: boolean
}

// Golden ratio constant
const GOLDEN_RATIO = 1.618

// Compute default sizes from the golden ratio (percentages)
// - Left panel share = 1 / (2 + φ) ≈ 0.276 (27.6%)
// - Center panel share = φ / (2 + φ) ≈ 0.447 (44.7%)
// - Right panel share = 1 / (2 + φ) ≈ 0.276 (27.6%)
const totalRatio = 2 + GOLDEN_RATIO
const sideRatio = 1 / totalRatio
const centerRatio = GOLDEN_RATIO / totalRatio

const defaultLeftSize = sideRatio * 100 // ≈ 27.6
const defaultCenterSize = centerRatio * 100 // ≈ 44.7
const defaultRightSize = sideRatio * 100 // ≈ 27.6

export default function ResizableLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  minLeftWidth = 200,
  minRightWidth = 200,
  minCenterWidth = 300
}: ResizableLayoutProps): ReactElement {
  const leftPanelRef = usePanelRef()
  const rightPanelRef = usePanelRef()

  const [isLeftCollapsed, setIsLeftCollapsed] = React.useState(false)
  const [isRightCollapsed, setIsRightCollapsed] = React.useState(false)

  // Collapse/expand the left panel
  const toggleLeftPanel = useCallback(() => {
    const panel = leftPanelRef.current
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand()
      } else {
        panel.collapse()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Collapse/expand the right panel
  const toggleRightPanel = useCallback(() => {
    const panel = rightPanelRef.current
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand()
      } else {
        panel.collapse()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for panel toggle shortcuts
  useEffect(() => {
    const handleToggleKnowledgeBase = () => {
      toggleLeftPanel()
    }

    const handleToggleCreativeSpace = () => {
      toggleRightPanel()
    }

    window.addEventListener('shortcut:toggle-knowledge-base', handleToggleKnowledgeBase)
    window.addEventListener('shortcut:toggle-creative-space', handleToggleCreativeSpace)

    return () => {
      window.removeEventListener('shortcut:toggle-knowledge-base', handleToggleKnowledgeBase)
      window.removeEventListener('shortcut:toggle-creative-space', handleToggleCreativeSpace)
    }
  }, [toggleLeftPanel, toggleRightPanel])

  return (
    <div className="flex flex-1 overflow-hidden p-2">
      <ResizablePanelGroup orientation="horizontal" className="h-full gap-1">
        {/* Left panel */}
        <ResizablePanel
          panelRef={leftPanelRef}
          defaultSize={defaultLeftSize}
          minSize={minLeftWidth}
          collapsible
          collapsedSize={0}
          onResize={(size) => setIsLeftCollapsed(Number(size) === 0)}
        >
          {leftPanel}
        </ResizablePanel>

        {/* Left drag handle */}
        <ResizableHandle />

        {/* Center panel */}
        <ResizablePanel defaultSize={defaultCenterSize} minSize={minCenterWidth}>
          {}
          {React.cloneElement(centerPanel as ReactElement<CenterPanelInjectedProps>, {
            onToggleLeft: toggleLeftPanel,
            onToggleRight: toggleRightPanel,
            isLeftCollapsed,
            isRightCollapsed
          })}
        </ResizablePanel>

        {/* Right drag handle */}
        <ResizableHandle />

        {/* Right panel */}
        <ResizablePanel
          panelRef={rightPanelRef}
          defaultSize={defaultRightSize}
          minSize={minRightWidth}
          collapsible
          collapsedSize={0}
          onResize={(size) => setIsRightCollapsed(Number(size) === 0)}
        >
          {rightPanel}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
