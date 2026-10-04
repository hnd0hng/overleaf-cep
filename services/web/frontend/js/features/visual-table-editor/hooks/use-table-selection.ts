import {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { CellPoint, CellSelection } from '../types'

export type TableSelectionMode = 'cells' | 'rows' | 'columns'

type SelectionTarget = {
  mode: TableSelectionMode
  point: CellPoint
}

type SelectionEvent = ReactPointerEvent<HTMLElement>

type Options = {
  columnCount: number
  gridRef: RefObject<HTMLDivElement>
  rowCount: number
  selection: CellSelection
  setSelection: Dispatch<SetStateAction<CellSelection>>
}

const isInteractiveTarget = (target: EventTarget) =>
  target instanceof Element &&
  Boolean(target.closest('button, input, select, textarea, .vte-resize-handle'))

export const selectionForTarget = (
  mode: TableSelectionMode,
  anchor: CellPoint,
  target: CellPoint,
  rowCount: number,
  columnCount: number
): CellSelection => {
  if (mode === 'rows') {
    return {
      from: { row: anchor.row, column: 0 },
      to: { row: target.row, column: columnCount - 1 },
    }
  }
  if (mode === 'columns') {
    return {
      from: { row: 0, column: anchor.column },
      to: { row: rowCount - 1, column: target.column },
    }
  }
  return { from: anchor, to: target }
}

export default function useTableSelection({
  columnCount,
  gridRef,
  rowCount,
  selection,
  setSelection,
}: Options) {
  const drag = useRef<SelectionTarget | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  const finishSelection = useCallback(() => {
    drag.current = null
    setIsSelecting(false)
  }, [])

  useEffect(() => {
    window.addEventListener('pointerup', finishSelection)
    window.addEventListener('pointercancel', finishSelection)
    return () => {
      window.removeEventListener('pointerup', finishSelection)
      window.removeEventListener('pointercancel', finishSelection)
    }
  }, [finishSelection])

  const beginSelection = useCallback(
    (mode: TableSelectionMode, point: CellPoint, event: SelectionEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return
      event.preventDefault()
      gridRef.current?.focus({ preventScroll: true })
      const anchor = event.shiftKey ? selection.from : point
      drag.current = { mode, point: anchor }
      setIsSelecting(true)
      setSelection(
        selectionForTarget(mode, anchor, point, rowCount, columnCount)
      )
    },
    [columnCount, gridRef, rowCount, selection.from, setSelection]
  )

  const extendSelection = useCallback(
    (mode: TableSelectionMode, point: CellPoint, event: SelectionEvent) => {
      const active = drag.current
      if (!active || active.mode !== mode) return
      if ((event.buttons & 1) === 0) {
        finishSelection()
        return
      }
      event.preventDefault()
      setSelection(
        selectionForTarget(mode, active.point, point, rowCount, columnCount)
      )
    },
    [columnCount, finishSelection, rowCount, setSelection]
  )

  return { beginSelection, extendSelection, isSelecting }
}
