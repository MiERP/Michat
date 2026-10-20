/**
 * useDraggableDialog
 * Cho phép kéo dialog Radix đi quanh màn hình bằng vùng header.
 * Khi bắt đầu kéo, dialog chuyển từ centered (translate -50%) sang
 * vị trí tuyệt đối left/top theo con trỏ.
 */

import { useCallback, useRef, useState } from 'react'

export function useDraggableDialog() {
  const contentRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const startDrag = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('button')) return

    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return

    event.preventDefault()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top

    const handleMove = (moveEvent: MouseEvent) => {
      setPosition({
        x: moveEvent.clientX - offsetX,
        y: moveEvent.clientY - offsetY
      })
    }

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [])

  const dragStyle: React.CSSProperties | undefined = position
    ? { left: `${position.x}px`, top: `${position.y}px`, transform: 'none' }
    : undefined

  return { contentRef, startDrag, dragStyle }
}
