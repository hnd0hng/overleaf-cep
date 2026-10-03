import {
  CellPoint,
  CellSelection,
  createId,
  emptyBorders,
  HorizontalAlignment,
  TableCell,
  TableModel,
  VerticalAlignment,
} from './types'

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
  const cells = selectedCells(next, selection)
  const exactlyCovered = cells.every(
    cell =>
      cell.row >= range.minRow &&
      cell.column >= range.minColumn &&
      cell.row + cell.rowSpan - 1 <= range.maxRow &&
      cell.column + cell.columnSpan - 1 <= range.maxColumn
  )
  if (!exactlyCovered) throw new Error('Selection cuts through a merged cell')
  const content = cells
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map(cell => cell.content.text || cell.content.rawLatex || '')
    .filter(Boolean)
    .join(' ')
  for (const cell of cells) delete next.cells[cell.id]
  const merged = createCell(range.minRow, range.minColumn)
  merged.rowSpan = range.maxRow - range.minRow + 1
  merged.columnSpan = range.maxColumn - range.minColumn + 1
  merged.content.text = content
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
        if (row === cell.row && column === cell.column) {
          replacement.content = cell.content
        }
        next.cells[replacement.id] = replacement
      }
    }
  }
  assertModel(next)
  return next
}

export const insertRow = (model: TableModel, index: number) => {
  const next = cloneModel(model)
  next.rows.splice(index, 0, { id: createId('row') })
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
  next.columns.splice(index, 0, {
    id: createId('column'),
    alignment: 'center',
    verticalAlignment: 'top',
    width: { mode: 'auto' },
  })
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
  if (to - from + 1 >= next.columns.length)
    throw new Error('A table needs one column')
  const count = to - from + 1
  next.columns.splice(from, count)
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

export const moveRow = (model: TableModel, from: number, to: number) => {
  if (from === to) return model
  const expanded = getCells(model).some(cell => cell.rowSpan > 1)
  if (expanded)
    throw new Error('Split vertically merged cells before moving rows')
  const next = cloneModel(model)
  const [row] = next.rows.splice(from, 1)
  next.rows.splice(to, 0, row)
  for (const cell of getCells(next)) {
    if (cell.row === from) cell.row = to
    else if (from < to && cell.row > from && cell.row <= to) cell.row--
    else if (from > to && cell.row >= to && cell.row < from) cell.row++
  }
  return next
}

export const moveColumn = (model: TableModel, from: number, to: number) => {
  if (from === to) return model
  const expanded = getCells(model).some(cell => cell.columnSpan > 1)
  if (expanded)
    throw new Error('Split horizontally merged cells before moving columns')
  const next = cloneModel(model)
  const [column] = next.columns.splice(from, 1)
  next.columns.splice(to, 0, column)
  for (const cell of getCells(next)) {
    if (cell.column === from) cell.column = to
    else if (from < to && cell.column > from && cell.column <= to) cell.column--
    else if (from > to && cell.column >= to && cell.column < from) cell.column++
  }
  return next
}

export const transpose = (model: TableModel) => {
  const next = cloneModel(model)
  const rows = next.rows
  next.rows = next.columns.map(column => ({ id: column.id }))
  next.columns = rows.map(row => ({
    id: row.id,
    alignment: 'center',
    verticalAlignment: 'top',
    width: { mode: 'auto' },
  }))
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
  horizontal?: HorizontalAlignment,
  vertical?: VerticalAlignment
) => {
  const next = cloneModel(model)
  for (const cell of selectedCells(next, selection)) {
    if (horizontal) cell.horizontalAlignment = horizontal
    if (vertical) cell.verticalAlignment = vertical
  }
  if (vertical) {
    const range = normalizeSelection(selection)
    for (let column = range.minColumn; column <= range.maxColumn; column++) {
      next.columns[column].verticalAlignment = vertical
      if (next.columns[column].width.mode === 'auto') {
        next.columns[column].width = { mode: 'fixed', value: 3, unit: 'cm' }
      }
    }
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
    cell.numberFormat = undefined
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
    next.columns.push({
      id: createId('column'),
      alignment: 'center',
      verticalAlignment: 'top',
      width: { mode: 'auto' },
    })
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

export const formatNumbers = (
  model: TableModel,
  selection: CellSelection,
  precision?: number,
  thousandsSeparator = false,
  decimalSeparator: '.' | ',' = '.'
) => {
  const next = cloneModel(model)
  for (const cell of selectedCells(next, selection)) {
    const normalized =
      decimalSeparator === ','
        ? cell.content.text.replaceAll('.', '').replace(',', '.')
        : cell.content.text.replaceAll(',', '')
    const numeric = Number(normalized)
    if (!Number.isNaN(numeric)) {
      let formatted = numeric.toLocaleString('en-US', {
        useGrouping: thousandsSeparator,
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })
      if (decimalSeparator === ',') {
        formatted = formatted
          .replaceAll(',', '__GROUP__')
          .replace('.', ',')
          .replaceAll('__GROUP__', '.')
      }
      cell.content.text = formatted
      cell.numberFormat = {
        precision,
        thousandsSeparator,
        decimalSeparator,
      }
    }
  }
  return next
}
