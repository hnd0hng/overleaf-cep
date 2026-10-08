import {
  CellPoint,
  CellSelection,
  createId,
  emptyBorders,
  HorizontalAlignment,
  LongtableSection,
  TableCell,
  TableModel,
} from './types'
import {
  rowMoveCrossesLongtableSection,
  sectionForInsertion,
  selectionCrossesLongtableSection,
} from './latex/longtable-sections'

export const normalizeSelection = (selection: CellSelection) => ({
  minRow: Math.min(selection.from.row, selection.to.row),
  maxRow: Math.max(selection.from.row, selection.to.row),
  minColumn: Math.min(selection.from.column, selection.to.column),
  maxColumn: Math.max(selection.from.column, selection.to.column),
})

export const cloneModel = (model: TableModel): TableModel =>
  structuredClone(model)

export const getCells = (model: TableModel) => Object.values(model.cells)

const occupancyCache = new WeakMap<TableModel, Map<string, TableCell>>()

const buildOccupancy = (model: TableModel) => {
  const cached = occupancyCache.get(model)
  if (cached) return cached
  const occupied = new Map<string, TableCell>()
  for (const cell of getCells(model)) {
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (
        let column = cell.column;
        column < cell.column + cell.columnSpan;
        column++
      ) {
        occupied.set(`${row}:${column}`, cell)
      }
    }
  }
  occupancyCache.set(model, occupied)
  return occupied
}

export const cellAt = (model: TableModel, row: number, column: number) =>
  buildOccupancy(model).get(`${row}:${column}`)

export const selectedCells = (model: TableModel, selection: CellSelection) => {
  const range = normalizeSelection(selection)
  return getCells(model).filter(
    cell =>
      cell.row <= range.maxRow &&
      cell.row + cell.rowSpan - 1 >= range.minRow &&
      cell.column <= range.maxColumn &&
      cell.column + cell.columnSpan - 1 >= range.minColumn
  )
}

const createCell = (row: number, column: number): TableCell => ({
  id: createId('cell'),
  row,
  column,
  rowSpan: 1,
  columnSpan: 1,
  content: { text: '' },
  borders: emptyBorders(),
})

const fillHoles = (model: TableModel) => {
  const occupied = buildOccupancy(model)
  for (let row = 0; row < model.rows.length; row++) {
    for (let column = 0; column < model.columns.length; column++) {
      if (!occupied.has(`${row}:${column}`)) {
        const cell = createCell(row, column)
        model.cells[cell.id] = cell
        occupied.set(`${row}:${column}`, cell)
      }
    }
  }
}

const ensureColumnBoundaries = (model: TableModel) => {
  if (model.columnBoundaries?.length === model.columns.length + 1) return
  model.columnBoundaries = Array.from(
    { length: model.columns.length + 1 },
    (_, boundary) => {
      const left = boundary > 0 ? cellAt(model, 0, boundary - 1) : undefined
      const right =
        boundary < model.columns.length ? cellAt(model, 0, boundary) : undefined
      return right?.borders.left ?? left?.borders.right ?? 'none'
    }
  )
}

const synchronizeUniformColumnBoundaries = (model: TableModel) => {
  ensureColumnBoundaries(model)
  for (let boundary = 0; boundary <= model.columns.length; boundary++) {
    const styles = new Set(
      model.rows.flatMap((_, row) => {
        const left = boundary > 0 ? cellAt(model, row, boundary - 1) : undefined
        const right =
          boundary < model.columns.length
            ? cellAt(model, row, boundary)
            : undefined
        if (left && right && left.id === right.id) return []
        return boundary === 0
          ? [right?.borders.left ?? 'none']
          : boundary === model.columns.length
            ? [left?.borders.right ?? 'none']
            : [left?.borders.right ?? 'none', right?.borders.left ?? 'none']
      })
    )
    if (styles.size === 1) model.columnBoundaries[boundary] = [...styles][0]
  }
}

export const assertModel = (model: TableModel) => {
  const occupied = new Set<string>()
  for (const cell of getCells(model)) {
    if (
      cell.row < 0 ||
      cell.column < 0 ||
      cell.rowSpan < 1 ||
      cell.columnSpan < 1 ||
      cell.row + cell.rowSpan > model.rows.length ||
      cell.column + cell.columnSpan > model.columns.length
    ) {
      throw new Error(`Cell ${cell.id} is outside the table`)
    }
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (
        let column = cell.column;
        column < cell.column + cell.columnSpan;
        column++
      ) {
        const key = `${row}:${column}`
        if (occupied.has(key)) throw new Error(`Overlapping cell at ${key}`)
        occupied.add(key)
      }
    }
  }
  if (occupied.size !== model.rows.length * model.columns.length) {
    throw new Error('Table model has uncovered coordinates')
  }
}

export const updateCellText = (
  model: TableModel,
  point: CellPoint,
  text: string
) => {
  const next = cloneModel(model)
  const cell = cellAt(next, point.row, point.column)
  if (cell) cell.content = { text }
  return next
}

export const mergeSelection = (model: TableModel, selection: CellSelection) => {
  const next = cloneModel(model)
  const range = normalizeSelection(selection)
  if (selectionCrossesLongtableSection(next, range.minRow, range.maxRow)) {
    throw new Error(
      'Cells cannot be merged across a longtable section boundary.'
    )
  }
  const cells = selectedCells(next, selection)
  const exactlyCovered = cells.every(
    cell =>
      cell.row >= range.minRow &&
      cell.column >= range.minColumn &&
      cell.row + cell.rowSpan - 1 <= range.maxRow &&
      cell.column + cell.columnSpan - 1 <= range.maxColumn
  )
  if (!exactlyCovered) throw new Error('Selection cuts through a merged cell')
  const anchor = cells.find(
    cell => cell.row === range.minRow && cell.column === range.minColumn
  )
  const content = cells
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map(cell => cell.content.text || cell.content.rawLatex || '')
    .filter(Boolean)
    .join(' ')
  for (const cell of cells) delete next.cells[cell.id]
  const merged = createCell(range.minRow, range.minColumn)
  merged.rowSpan = range.maxRow - range.minRow + 1
  merged.columnSpan = range.maxColumn - range.minColumn + 1
  merged.content = {
    text: content,
    style: anchor?.content.style
      ? structuredClone(anchor.content.style)
      : undefined,
  }
  merged.backgroundColor = anchor?.backgroundColor
  merged.horizontalAlignment = anchor?.horizontalAlignment
  merged.verticalAlignment = anchor?.verticalAlignment
  merged.borders = {
    top: cells.some(
      cell => cell.row === range.minRow && cell.borders.top !== 'none'
    )
      ? 'solid'
      : 'none',
    right: cells.some(
      cell =>
        cell.column + cell.columnSpan - 1 === range.maxColumn &&
        cell.borders.right !== 'none'
    )
      ? 'solid'
      : 'none',
    bottom: cells.some(
      cell =>
        cell.row + cell.rowSpan - 1 === range.maxRow &&
        cell.borders.bottom !== 'none'
    )
      ? 'solid'
      : 'none',
    left: cells.some(
      cell => cell.column === range.minColumn && cell.borders.left !== 'none'
    )
      ? 'solid'
      : 'none',
  }
  next.cells[merged.id] = merged
  assertModel(next)
  return next
}

export const splitSelection = (model: TableModel, selection: CellSelection) => {
  const next = cloneModel(model)
  for (const cell of selectedCells(next, selection)) {
    if (cell.rowSpan === 1 && cell.columnSpan === 1) continue
    delete next.cells[cell.id]
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (
        let column = cell.column;
        column < cell.column + cell.columnSpan;
        column++
      ) {
        const replacement = createCell(row, column)
        replacement.backgroundColor = cell.backgroundColor
        replacement.horizontalAlignment = cell.horizontalAlignment
        replacement.verticalAlignment = cell.verticalAlignment
        if (row === cell.row && column === cell.column) {
          replacement.content = structuredClone(cell.content)
        }
        replacement.borders = {
          top: row === cell.row ? cell.borders.top : emptyBorders().top,
          right:
            column === cell.column + cell.columnSpan - 1
              ? cell.borders.right
              : emptyBorders().right,
          bottom:
            row === cell.row + cell.rowSpan - 1
              ? cell.borders.bottom
              : emptyBorders().bottom,
          left:
            column === cell.column ? cell.borders.left : emptyBorders().left,
        }
        next.cells[replacement.id] = replacement
      }
    }
  }
  assertModel(next)
  return next
}

export const insertRow = (
  model: TableModel,
  index: number,
  longtableSection?: LongtableSection
) => {
  const next = cloneModel(model)
  const newRow = {
    id: createId('row'),
    longtableSection: longtableSection ?? sectionForInsertion(next, index),
  }
  next.rows.splice(index, 0, newRow)
  for (const cell of getCells(next)) {
    if (cell.row >= index) cell.row++
    else if (cell.row + cell.rowSpan > index) cell.rowSpan++
  }
  fillHoles(next)
  assertModel(next)
  return next
}

export const insertColumn = (model: TableModel, index: number) => {
  const next = cloneModel(model)
  ensureColumnBoundaries(next)
  next.columns.splice(index, 0, {
    id: createId('column'),
    alignment: 'center',
    verticalAlignment: 'top',
    width: { mode: 'auto' },
  })
  const inheritedBoundary = next.columnBoundaries[index] ?? 'none'
  next.columnBoundaries.splice(index, 0, inheritedBoundary)
  for (const cell of getCells(next)) {
    if (cell.column >= index) cell.column++
    else if (cell.column + cell.columnSpan > index) cell.columnSpan++
  }
  fillHoles(next)
  assertModel(next)
  return next
}

export const deleteRows = (model: TableModel, from: number, to: number) => {
  const next = cloneModel(model)
  if (to - from + 1 >= next.rows.length)
    throw new Error('A table needs one row')
  const count = to - from + 1
  next.rows.splice(from, count)
  for (const cell of getCells(next)) {
    const overlap = Math.max(
      0,
      Math.min(cell.row + cell.rowSpan, to + 1) - Math.max(cell.row, from)
    )
    if (overlap === cell.rowSpan) delete next.cells[cell.id]
    else {
      if (cell.row >= from) cell.row = Math.max(from, cell.row - count)
      cell.rowSpan -= overlap
    }
  }
  fillHoles(next)
  assertModel(next)
  return next
}

export const deleteColumns = (model: TableModel, from: number, to: number) => {
  const next = cloneModel(model)
  ensureColumnBoundaries(next)
  if (to - from + 1 >= next.columns.length)
    throw new Error('A table needs one column')
  const count = to - from + 1
  const rightBoundary = next.columnBoundaries[to + 1] ?? 'none'
  next.columns.splice(from, count)
  next.columnBoundaries.splice(from + 1, count)
  if (to === model.columns.length - 1) {
    next.columnBoundaries[from] = rightBoundary
  }
  for (const cell of getCells(next)) {
    const overlap = Math.max(
      0,
      Math.min(cell.column + cell.columnSpan, to + 1) -
        Math.max(cell.column, from)
    )
    if (overlap === cell.columnSpan) delete next.cells[cell.id]
    else {
      if (cell.column >= from) cell.column = Math.max(from, cell.column - count)
      cell.columnSpan -= overlap
    }
  }
  fillHoles(next)
  assertModel(next)
  return next
}

type ReorderAxis = 'row' | 'column'

const reorderError = (
  model: TableModel,
  axis: ReorderAxis,
  from: number,
  to: number,
  insertionIndex: number
) => {
  const count = axis === 'row' ? model.rows.length : model.columns.length
  if (
    from < 0 ||
    to < from ||
    to >= count ||
    insertionIndex < 0 ||
    insertionIndex > count
  ) {
    return 'Invalid table reorder range'
  }
  if (insertionIndex >= from && insertionIndex <= to + 1) return null
  if (
    axis === 'row' &&
    rowMoveCrossesLongtableSection(model, from, to, insertionIndex)
  ) {
    return 'Rows cannot be moved across a longtable section boundary.'
  }

  for (const cell of getCells(model)) {
    const start = axis === 'row' ? cell.row : cell.column
    const span = axis === 'row' ? cell.rowSpan : cell.columnSpan
    if (span === 1) continue
    const end = start + span - 1
    const intersectsSource = start <= to && end >= from
    const containedInSource = start >= from && end <= to
    if (intersectsSource && !containedInSource) {
      return 'This move would split a merged cell.'
    }
    if (!containedInSource && insertionIndex > start && insertionIndex <= end) {
      return 'You cannot drop here because this position is inside a merged cell.'
    }
  }
  return null
}

export const getRowMoveError = (
  model: TableModel,
  from: number,
  to: number,
  insertionIndex: number
) => reorderError(model, 'row', from, to, insertionIndex)

export const getColumnMoveError = (
  model: TableModel,
  from: number,
  to: number,
  insertionIndex: number
) => reorderError(model, 'column', from, to, insertionIndex)

const reorderRange = (
  model: TableModel,
  axis: ReorderAxis,
  from: number,
  to: number,
  insertionIndex: number
) => {
  const error = reorderError(model, axis, from, to, insertionIndex)
  if (error) throw new Error(error)
  if (insertionIndex >= from && insertionIndex <= to + 1) return model

  const next = cloneModel(model)
  const count = axis === 'row' ? next.rows.length : next.columns.length
  const movedCount = to - from + 1
  const order = Array.from({ length: count }, (_, index) => index)
  const moved = order.splice(from, movedCount)
  const target =
    insertionIndex > to ? insertionIndex - movedCount : insertionIndex
  order.splice(target, 0, ...moved)

  if (axis === 'row') {
    const oldRows = [...next.rows]
    next.rows = order.map(index => oldRows[index])
  } else {
    const oldColumns = [...next.columns]
    next.columns = order.map(index => oldColumns[index])
  }

  const newIndex = new Map(order.map((oldIndex, index) => [oldIndex, index]))
  for (const cell of getCells(next)) {
    const start = axis === 'row' ? cell.row : cell.column
    const span = axis === 'row' ? cell.rowSpan : cell.columnSpan
    const mapped = Array.from(
      { length: span },
      (_, offset) => newIndex.get(start + offset)!
    ).sort((a, b) => a - b)
    if (
      mapped.some(
        (index, offset) => offset > 0 && index !== mapped[offset - 1] + 1
      )
    ) {
      throw new Error('This move would split a merged cell.')
    }
    if (axis === 'row') cell.row = mapped[0]
    else cell.column = mapped[0]
  }
  assertModel(next)
  return next
}

export const moveRows = (
  model: TableModel,
  from: number,
  to: number,
  insertionIndex: number
) => reorderRange(model, 'row', from, to, insertionIndex)

export const moveColumns = (
  model: TableModel,
  from: number,
  to: number,
  insertionIndex: number
) => reorderRange(model, 'column', from, to, insertionIndex)

export const moveRow = (model: TableModel, from: number, to: number) =>
  moveRows(model, from, from, to > from ? to + 1 : to)

export const moveColumn = (model: TableModel, from: number, to: number) =>
  moveColumns(model, from, from, to > from ? to + 1 : to)

export const transpose = (model: TableModel) => {
  if (
    model.options.environment === 'longtable' &&
    model.rows.some(row => row.longtableSection)
  ) {
    throw new Error('A structured longtable cannot be transposed.')
  }
  const next = cloneModel(model)
  const rows = next.rows
  next.rows = next.columns.map(column => ({ id: column.id }))
  next.columns = rows.map(row => ({
    id: row.id,
    alignment: 'center',
    verticalAlignment: 'top',
    width: { mode: 'auto' },
  }))
  next.columnBoundaries = Array.from(
    { length: next.columns.length + 1 },
    () => 'none'
  )
  for (const cell of getCells(next)) {
    ;[cell.row, cell.column] = [cell.column, cell.row]
    ;[cell.rowSpan, cell.columnSpan] = [cell.columnSpan, cell.rowSpan]
  }
  assertModel(next)
  return next
}

export const applyAlignment = (
  model: TableModel,
  selection: CellSelection,
  horizontal: HorizontalAlignment
) => {
  const next = cloneModel(model)
  for (const cell of selectedCells(next, selection)) {
    cell.horizontalAlignment = horizontal
  }
  return next
}

export const applyTextStyle = (
  model: TableModel,
  selection: CellSelection,
  style: { bold?: boolean; italic?: boolean; color?: string }
) => {
  const next = cloneModel(model)
  for (const cell of selectedCells(next, selection)) {
    cell.content.style = { ...cell.content.style, ...style }
  }
  return next
}

export const clearFormatting = (
  model: TableModel,
  selection: CellSelection
) => {
  const next = cloneModel(model)
  for (const cell of selectedCells(next, selection)) {
    cell.content.style = undefined
    cell.backgroundColor = undefined
    cell.horizontalAlignment = undefined
    cell.verticalAlignment = undefined
  }
  return next
}

export type BorderOperation =
  | 'all'
  | 'outer'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'horizontal'
  | 'vertical'
  | 'none'

export const applyBorders = (
  model: TableModel,
  selection: CellSelection,
  operation: BorderOperation
) => {
  const next = cloneModel(model)
  const range = normalizeSelection(selection)
  for (const cell of selectedCells(next, selection)) {
    if (operation === 'none') {
      cell.borders = emptyBorders()
      continue
    }
    const top = cell.row === range.minRow
    const bottom = cell.row + cell.rowSpan - 1 === range.maxRow
    const left = cell.column === range.minColumn
    const right = cell.column + cell.columnSpan - 1 === range.maxColumn
    if (
      operation === 'all' ||
      operation === 'horizontal' ||
      operation === 'top' ||
      (operation === 'outer' && top)
    ) {
      if (operation !== 'top' || top) cell.borders.top = 'solid'
    }
    if (
      operation === 'all' ||
      operation === 'horizontal' ||
      operation === 'bottom' ||
      (operation === 'outer' && bottom)
    ) {
      if (operation !== 'bottom' || bottom) cell.borders.bottom = 'solid'
    }
    if (
      operation === 'all' ||
      operation === 'vertical' ||
      operation === 'left' ||
      (operation === 'outer' && left)
    ) {
      if (operation !== 'left' || left) cell.borders.left = 'solid'
    }
    if (
      operation === 'all' ||
      operation === 'vertical' ||
      operation === 'right' ||
      (operation === 'outer' && right)
    ) {
      if (operation !== 'right' || right) cell.borders.right = 'solid'
    }
  }
  synchronizeUniformColumnBoundaries(next)
  return next
}

export const pasteMatrix = (
  model: TableModel,
  start: CellPoint,
  matrix: string[][]
) => {
  const next = cloneModel(model)
  const neededRows = start.row + matrix.length
  const neededColumns =
    start.column + Math.max(0, ...matrix.map(row => row.length))
  while (next.rows.length < neededRows) next.rows.push({ id: createId('row') })
  while (next.columns.length < neededColumns) {
    ensureColumnBoundaries(next)
    next.columns.push({
      id: createId('column'),
      alignment: 'center',
      verticalAlignment: 'top',
      width: { mode: 'auto' },
    })
    next.columnBoundaries.push('none')
  }
  fillHoles(next)
  const occupied = buildOccupancy(next)
  matrix.forEach((row, rowOffset) =>
    row.forEach((text, columnOffset) => {
      const cell = occupied.get(
        `${start.row + rowOffset}:${start.column + columnOffset}`
      )
      if (cell) cell.content = { text }
    })
  )
  return next
}

export const replaceText = (
  model: TableModel,
  search: string,
  replacement: string,
  selection?: CellSelection,
  all = true
) => {
  const next = cloneModel(model)
  const cells = selection ? selectedCells(next, selection) : getCells(next)
  for (const cell of cells) {
    if (!cell.content.rawLatex) {
      cell.content.text = all
        ? cell.content.text.split(search).join(replacement)
        : cell.content.text.replace(search, replacement)
    }
  }
  return next
}
