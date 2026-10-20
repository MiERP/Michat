import * as React from 'react'
import { cn } from '@/lib/utils'
import { isMac, isWindows } from '@/lib/platform'

interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  left?: React.ReactNode
  center?: React.ReactNode
  right?: React.ReactNode
  draggable?: boolean
  brand?: boolean
}

const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ left, center, right, draggable, brand, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'h-12 shrink-0 flex items-center justify-between',
          brand ? 'brand-topbar px-2 gap-0.5' : 'brand-panel-header px-4 border-b border-border',
          className
        )}
        style={draggable ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
        {...props}
      >
        {brand && isMac() && <div className="w-20" />}
        {left && <div className="flex items-center gap-2">{left}</div>}
        {center && <div className="flex-1 flex items-center justify-center min-w-0">{center}</div>}
        {right && <div className="flex items-center gap-2">{right}</div>}
        {brand && isWindows() && <div className="w-32" />}
      </div>
    )
  }
)
PanelHeader.displayName = 'PanelHeader'

export { PanelHeader }
