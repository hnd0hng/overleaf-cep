import { KeyboardEvent, PointerEvent } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import { TableReorderAxis } from '../hooks/use-table-reorder'

type Props = {
  axis: TableReorderAxis
  index: number
  label: string
  onKeyboardMove: (
    axis: TableReorderAxis,
    index: number,
    direction: -1 | 1
  ) => void
  onPointerDown: (
    axis: TableReorderAxis,
    index: number,
    event: PointerEvent<HTMLButtonElement>
  ) => void
}

export default function VisualTableDragHandle({
  axis,
  index,
  label,
  onKeyboardMove,
  onPointerDown,
}: Props) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey) return
    const previous = axis === 'rows' ? 'ArrowUp' : 'ArrowLeft'
    const next = axis === 'rows' ? 'ArrowDown' : 'ArrowRight'
    if (event.key !== previous && event.key !== next) return
    event.preventDefault()
    event.stopPropagation()
    onKeyboardMove(axis, index, event.key === previous ? -1 : 1)
  }

  const arrowKeys =
    axis === 'rows'
      ? 'Alt+ArrowUp Alt+ArrowDown'
      : 'Alt+ArrowLeft Alt+ArrowRight'

  return (
    <button
      type="button"
      className="vte-drag-handle"
      aria-keyshortcuts={arrowKeys}
      aria-label={label}
      onKeyDown={handleKeyDown}
      onPointerDown={event => onPointerDown(axis, index, event)}
    >
      <MaterialIcon type="drag_indicator" />
    </button>
  )
}
