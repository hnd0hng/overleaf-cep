import type { Diagnostic, TableCell } from '../types'

type Candidate = {
  cell: TableCell
  empty: boolean
  sourceRow: number
  sourceColumn: number
}

type GridBuildResult = {
  cells: Record<string, TableCell>
  diagnostics: Diagnostic[]
  unsafe: boolean
}

const key = (row: number, column: number) => `${row}:${column}`

export const buildLatexGrid = (
  rows: string[][],
  rowCount: number,
  columnCount: number,
  parseCell: (source: string, row: number, column: number) => TableCell
): GridBuildResult => {
  const diagnostics: Diagnostic[] = []
  const candidates: Candidate[] = []
  let unsafe = false

  rows.forEach((values, sourceRow) => {
    let sourceColumn = 0
    for (const value of values) {
      const parsed = parseCell(value, sourceRow, sourceColumn)
      const rawRowSpan = parsed.rowSpan
      parsed.rowSpan = Math.max(1, Math.abs(rawRowSpan))
      parsed.row = rawRowSpan < 0 ? sourceRow + rawRowSpan + 1 : sourceRow
      parsed.column = sourceColumn
      parsed.id = `cell-${parsed.row}-${parsed.column}`
      candidates.push({
        cell: parsed,
        empty: !value.trim(),
        sourceRow,
        sourceColumn,
      })
      sourceColumn += Math.max(1, parsed.columnSpan)
    }
    if (sourceColumn > columnCount) {
      unsafe = true
      diagnostics.push({
        severity: 'warning',
        message: `Row ${sourceRow + 1} has too many column entries.`,
      })
    }
  })

  candidates.sort((left, right) => {
    const leftArea = left.cell.rowSpan * left.cell.columnSpan
    const rightArea = right.cell.rowSpan * right.cell.columnSpan
    return (
      rightArea - leftArea ||
      left.cell.row - right.cell.row ||
      left.cell.column - right.cell.column
    )
  })

  const occupied = new Map<string, TableCell>()
  const cells: Record<string, TableCell> = {}
  for (const candidate of candidates) {
    const { cell } = candidate
    const outside =
      cell.row < 0 ||
      cell.column < 0 ||
      cell.row + cell.rowSpan > rowCount ||
      cell.column + cell.columnSpan > columnCount
    if (outside) {
      unsafe = true
      diagnostics.push({
        severity: 'warning',
        message: `Merged cell at source row ${candidate.sourceRow + 1}, column ${candidate.sourceColumn + 1} is outside the table.`,
      })
      continue
    }

    const covered: string[] = []
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      for (
        let column = cell.column;
        column < cell.column + cell.columnSpan;
        column++
      ) {
        covered.push(key(row, column))
      }
    }
    if (covered.some(coordinate => occupied.has(coordinate))) {
      if (!candidate.empty) {
        unsafe = true
        diagnostics.push({
          severity: 'warning',
          message: `Cell at source row ${candidate.sourceRow + 1}, column ${candidate.sourceColumn + 1} overlaps a merged cell and was skipped.`,
        })
      }
      continue
    }
    cells[cell.id] = cell
    for (const coordinate of covered) occupied.set(coordinate, cell)
  }

  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < columnCount; column++) {
      const coordinate = key(row, column)
      if (occupied.has(coordinate)) continue
      const cell = parseCell('', row, column)
      cell.id = `cell-${row}-${column}`
      cells[cell.id] = cell
      occupied.set(coordinate, cell)
    }
  }

  return { cells, diagnostics, unsafe }
}
