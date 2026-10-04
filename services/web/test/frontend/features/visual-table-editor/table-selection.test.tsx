import { expect } from 'chai'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import useTableSelection, {
  selectionForTarget,
} from '@/features/visual-table-editor/hooks/use-table-selection'
import { CellPoint, CellSelection } from '@/features/visual-table-editor/types'

describe('table selection', function () {
  it('builds complete row and column ranges', function () {
    expect(
      selectionForTarget(
        'rows',
        { row: 3, column: 2 },
        { row: 1, column: 0 },
        5,
        4
      )
    ).to.deep.equal({
      from: { row: 3, column: 0 },
      to: { row: 1, column: 3 },
    })
    expect(
      selectionForTarget(
        'columns',
        { row: 2, column: 3 },
        { row: 0, column: 1 },
        5,
        4
      )
    ).to.deep.equal({
      from: { row: 0, column: 3 },
      to: { row: 4, column: 1 },
    })
  })

  it('selects a rectangular range by dragging and ends on pointer up', function () {
    render(<SelectionHarness />)

    fireEvent.pointerDown(screen.getByTestId('cell-0-0'), { button: 0 })
    fireEvent.pointerEnter(screen.getByTestId('cell-1-2'), { buttons: 1 })

    expect(screen.getByTestId('selection').textContent).to.equal('0,0:1,2')
    expect(screen.getByTestId('grid').getAttribute('data-selecting')).to.equal(
      'true'
    )
    expect(document.activeElement).to.equal(screen.getByTestId('grid'))

    fireEvent.pointerUp(window)
    expect(screen.getByTestId('grid').getAttribute('data-selecting')).to.equal(
      'false'
    )
  })

  it('extends from the previous anchor with Shift and ignores controls', function () {
    render(<SelectionHarness />)

    fireEvent.pointerDown(screen.getByTestId('cell-1-1'), { button: 0 })
    fireEvent.pointerUp(window)
    fireEvent.pointerDown(screen.getByTestId('cell-2-2'), {
      button: 0,
      shiftKey: true,
    })
    expect(screen.getByTestId('selection').textContent).to.equal('1,1:2,2')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Cell action' }), {
      button: 0,
    })
    expect(screen.getByTestId('selection').textContent).to.equal('1,1:2,2')
  })
})

function SelectionHarness() {
  const [selection, setSelection] = useState<CellSelection>({
    from: { row: 0, column: 0 },
    to: { row: 0, column: 0 },
  })
  const gridRef = useRef<HTMLDivElement>(null)
  const { beginSelection, extendSelection, isSelecting } = useTableSelection({
    columnCount: 3,
    gridRef,
    rowCount: 3,
    selection,
    setSelection,
  })
  const cells: CellPoint[] = []
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) cells.push({ row, column })
  }

  return (
    <div>
      <div
        data-testid="grid"
        data-selecting={isSelecting}
        ref={gridRef}
        tabIndex={0}
      >
        {cells.map(point => (
          <div
            data-testid={`cell-${point.row}-${point.column}`}
            key={`${point.row}-${point.column}`}
            onPointerDown={event => beginSelection('cells', point, event)}
            onPointerEnter={event => extendSelection('cells', point, event)}
          >
            {point.row === 0 && point.column === 0 && (
              <button type="button">Cell action</button>
            )}
          </div>
        ))}
      </div>
      <output data-testid="selection">
        {selection.from.row},{selection.from.column}:{selection.to.row},
        {selection.to.column}
      </output>
    </div>
  )
}
