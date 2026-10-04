import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { normalizeSelection } from '../model'
import { CellSelection } from '../types'

export type TableReorderAxis = 'rows' | 'columns'
export type TableReorderRange = { from: number; to: number }

export type TableReorderOperation = TableReorderRange & {
  axis: TableReorderAxis
  insertionIndex: number
}

export type TableReorderDrag = TableReorderOperation & {
  error: string | null
  indicatorStyle: CSSProperties
  valid: boolean
}

type Options = {
  columnCount: number
  getError: (operation: TableReorderOperation) => string | null
  getRange: (axis: TableReorderAxis, index: number) => TableReorderRange
  gridRef: RefObject<HTMLDivElement>
  onDrop: (operation: TableReorderOperation) => void
  onInvalidDrop: (message: string) => void
  rowCount: number
  rowHeight?: number
}

type ActiveDrag = TableReorderRange & {
  axis: TableReorderAxis
  lastClientX: number
  lastClientY: number
  startClientX: number
  startClientY: number
  started: boolean
}

const DRAG_THRESHOLD = 5
const AUTO_SCROLL_EDGE = 36
const AUTO_SCROLL_STEP = 14

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

export const selectedReorderRange = (
  axis: TableReorderAxis,
  index: number,
  selection: CellSelection,
  rowCount: number,
  columnCount: number
): TableReorderRange => {
  const range = normalizeSelection(selection)
  if (
    axis === 'rows' &&
    range.minColumn === 0 &&
    range.maxColumn === columnCount - 1 &&
    index >= range.minRow &&
    index <= range.maxRow
  ) {
    return { from: range.minRow, to: range.maxRow }
  }
  if (
    axis === 'columns' &&
    range.minRow === 0 &&
    range.maxRow === rowCount - 1 &&
    index >= range.minColumn &&
    index <= range.maxColumn
  ) {
    return { from: range.minColumn, to: range.maxColumn }
  }
  return { from: index, to: index }
}

export const reorderedRangeStart = ({
  from,
  to,
  insertionIndex,
}: TableReorderOperation) =>
  insertionIndex > to ? insertionIndex - (to - from + 1) : insertionIndex

export default function useTableReorder({
  columnCount,
  getError,
  getRange,
  gridRef,
  onDrop,
  onInvalidDrop,
  rowCount,
  rowHeight = 42,
}: Options) {
  const [drag, setDrag] = useState<TableReorderDrag | null>(null)
  const activeRef = useRef<ActiveDrag | null>(null)
  const dragRef = useRef<TableReorderDrag | null>(null)
  const cleanupRef = useRef<() => void>(() => {})
  const frameRef = useRef<number | undefined>(undefined)

  const updateDrag = useCallback(
    (active: ActiveDrag) => {
      const grid = gridRef.current
      if (!grid) return
      const gridRect = grid.getBoundingClientRect()
      let insertionIndex = 0
      let indicatorStyle: CSSProperties

      if (active.axis === 'rows') {
        const body = grid.querySelector<HTMLElement>('.vte-grid-body')
        if (!body) return
        const bodyRect = body.getBoundingClientRect()
        insertionIndex = clamp(
          Math.round((active.lastClientY - bodyRect.top) / rowHeight),
          0,
          rowCount
        )
        indicatorStyle = {
          left: gridRect.left,
          top: bodyRect.top + insertionIndex * rowHeight - 1,
          width: gridRect.width,
        }
      } else {
        const headers = Array.from(
          grid.querySelectorAll<HTMLElement>('[data-vte-column-index]')
        )
        insertionIndex = columnCount
        let indicatorLeft = headers.at(-1)?.getBoundingClientRect().right ?? 0
        for (const header of headers) {
          const rect = header.getBoundingClientRect()
          const index = Number(header.dataset.vteColumnIndex)
          if (active.lastClientX < rect.left + rect.width / 2) {
            insertionIndex = index
            indicatorLeft = rect.left
            break
          }
        }
        indicatorStyle = {
          height: gridRect.height,
          left: indicatorLeft - 1,
          top: gridRect.top,
        }
      }

      const operation = {
        axis: active.axis,
        from: active.from,
        to: active.to,
        insertionIndex,
      }
      const error = getError(operation)
      const next = {
        ...operation,
        error,
        indicatorStyle,
        valid: !error,
      }
      dragRef.current = next
      setDrag(next)
    },
    [columnCount, getError, gridRef, rowCount, rowHeight]
  )

  const stop = useCallback(
    (commit: boolean) => {
      const current = dragRef.current
      cleanupRef.current()
      if (commit && current) {
        const noOp =
          current.insertionIndex >= current.from &&
          current.insertionIndex <= current.to + 1
        if (current.error) onInvalidDrop(current.error)
        else if (!noOp) onDrop(current)
      }
      activeRef.current = null
      dragRef.current = null
      setDrag(null)
    },
    [onDrop, onInvalidDrop]
  )

  const beginReorder = useCallback(
    (
      axis: TableReorderAxis,
      index: number,
      event: ReactPointerEvent<HTMLButtonElement>
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.focus({ preventScroll: true })
      const range = getRange(axis, index)
      activeRef.current = {
        ...range,
        axis,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        startClientX: event.clientX,
        startClientY: event.clientY,
        started: false,
      }

      const pointerMove = (moveEvent: PointerEvent) => {
        const active = activeRef.current
        if (!active) return
        active.lastClientX = moveEvent.clientX
        active.lastClientY = moveEvent.clientY
        if (
          !active.started &&
          Math.hypot(
            moveEvent.clientX - active.startClientX,
            moveEvent.clientY - active.startClientY
          ) < DRAG_THRESHOLD
        ) {
          return
        }
        active.started = true
        moveEvent.preventDefault()
        updateDrag(active)
      }
      const pointerUp = () => stop(Boolean(activeRef.current?.started))
      const pointerCancel = () => stop(false)
      const keyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault()
          stop(false)
        }
      }
      const autoScroll = () => {
        const active = activeRef.current
        const grid = gridRef.current
        if (active?.started && grid) {
          const rect = grid.getBoundingClientRect()
          const horizontal =
            active.lastClientX < rect.left + AUTO_SCROLL_EDGE
              ? -AUTO_SCROLL_STEP
              : active.lastClientX > rect.right - AUTO_SCROLL_EDGE
                ? AUTO_SCROLL_STEP
                : 0
          const vertical =
            active.lastClientY < rect.top + AUTO_SCROLL_EDGE
              ? -AUTO_SCROLL_STEP
              : active.lastClientY > rect.bottom - AUTO_SCROLL_EDGE
                ? AUTO_SCROLL_STEP
                : 0
          if (horizontal || vertical) {
            grid.scrollBy(horizontal, vertical)
            updateDrag(active)
          }
        }
        frameRef.current = window.requestAnimationFrame(autoScroll)
      }

      window.addEventListener('pointermove', pointerMove, { passive: false })
      window.addEventListener('pointerup', pointerUp)
      window.addEventListener('pointercancel', pointerCancel)
      window.addEventListener('keydown', keyDown)
      frameRef.current = window.requestAnimationFrame(autoScroll)
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', pointerMove)
        window.removeEventListener('pointerup', pointerUp)
        window.removeEventListener('pointercancel', pointerCancel)
        window.removeEventListener('keydown', keyDown)
        if (frameRef.current !== undefined)
          window.cancelAnimationFrame(frameRef.current)
        cleanupRef.current = () => {}
      }
    },
    [getRange, gridRef, stop, updateDrag]
  )

  useEffect(() => () => cleanupRef.current(), [])

  return { beginReorder, cancelReorder: () => stop(false), drag }
}
