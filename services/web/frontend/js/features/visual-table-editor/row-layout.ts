import type { TableModel } from './types'

export const BASE_ROW_HEIGHT = 42
export const MULTILINE_ROW_INCREMENT = 20

const editableLineCount = (text: string) =>
  Math.max(1, text.split(/\r?\n/).length)

export const tableRowHeights = (model: TableModel) => {
  const heights = model.rows.map(() => BASE_ROW_HEIGHT)

  for (const cell of Object.values(model.cells)) {
    if (cell.rowSpan !== 1 || !cell.content.text) continue
    const required =
      BASE_ROW_HEIGHT +
      (editableLineCount(cell.content.text) - 1) * MULTILINE_ROW_INCREMENT
    heights[cell.row] = Math.max(heights[cell.row], required)
  }

  return heights
}

export const tableCellHeight = (
  rowHeights: number[],
  row: number,
  rowSpan: number
) =>
  Math.max(
    BASE_ROW_HEIGHT - 2,
    rowHeights
      .slice(row, row + rowSpan)
      .reduce((sum, value) => sum + value, 0) - 2
  )
