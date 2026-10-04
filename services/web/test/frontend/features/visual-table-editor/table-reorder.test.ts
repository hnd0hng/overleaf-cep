import { expect } from 'chai'
import {
  cellAt,
  getColumnMoveError,
  getRowMoveError,
  mergeSelection,
  moveColumns,
  moveRows,
  updateCellText,
} from '@/features/visual-table-editor/model'
import { createTableModel } from '@/features/visual-table-editor/types'

describe('Visual Table Editor reordering', function () {
  it('moves a contiguous row group and preserves row metadata and cells', function () {
    let model = createTableModel(4, 2)
    model.rows[1].repeatOnNewPage = true
    model = updateCellText(model, { row: 1, column: 0 }, 'First moved row')
    model = updateCellText(model, { row: 2, column: 0 }, 'Second moved row')
    const firstMovedId = model.rows[1].id
    const secondMovedId = model.rows[2].id

    const moved = moveRows(model, 1, 2, 4)

    expect(moved.rows.map(row => row.id).slice(2)).to.deep.equal([
      firstMovedId,
      secondMovedId,
    ])
    expect(moved.rows[2].repeatOnNewPage).to.equal(true)
    expect(cellAt(moved, 2, 0)?.content.text).to.equal('First moved row')
    expect(cellAt(moved, 3, 0)?.content.text).to.equal('Second moved row')
  })

  it('moves a contiguous column group and preserves column metadata', function () {
    let model = createTableModel(2, 4)
    model.columns[1].width = { mode: 'fixed', value: 4, unit: 'cm' }
    model = updateCellText(model, { row: 0, column: 1 }, 'First moved column')
    const firstMovedId = model.columns[1].id
    const secondMovedId = model.columns[2].id

    const moved = moveColumns(model, 1, 2, 4)

    expect(moved.columns.map(column => column.id).slice(2)).to.deep.equal([
      firstMovedId,
      secondMovedId,
    ])
    expect(moved.columns[2].width).to.deep.equal({
      mode: 'fixed',
      value: 4,
      unit: 'cm',
    })
    expect(cellAt(moved, 0, 2)?.content.text).to.equal('First moved column')
  })

  it('treats drops inside or adjacent to the source as no-ops', function () {
    const model = createTableModel(4, 4)
    expect(moveRows(model, 1, 2, 1)).to.equal(model)
    expect(moveRows(model, 1, 2, 3)).to.equal(model)
    expect(moveColumns(model, 1, 2, 2)).to.equal(model)
  })

  it('moves merged cells when they are fully inside the row group', function () {
    const model = mergeSelection(createTableModel(4, 2), {
      from: { row: 1, column: 0 },
      to: { row: 2, column: 0 },
    })

    const moved = moveRows(model, 1, 2, 4)
    expect(cellAt(moved, 2, 0)).to.deep.include({ row: 2, rowSpan: 2 })
  })

  it('blocks a source or destination that cuts through a merged cell', function () {
    const rows = mergeSelection(createTableModel(4, 2), {
      from: { row: 1, column: 0 },
      to: { row: 2, column: 0 },
    })
    expect(getRowMoveError(rows, 1, 1, 4)).to.equal(
      'This move would split a merged cell.'
    )
    expect(getRowMoveError(rows, 3, 3, 2)).to.equal(
      'You cannot drop here because this position is inside a merged cell.'
    )

    const columns = mergeSelection(createTableModel(2, 4), {
      from: { row: 0, column: 1 },
      to: { row: 0, column: 2 },
    })
    expect(getColumnMoveError(columns, 1, 1, 4)).to.equal(
      'This move would split a merged cell.'
    )
    expect(getColumnMoveError(columns, 3, 3, 2)).to.equal(
      'You cannot drop here because this position is inside a merged cell.'
    )
  })
})
