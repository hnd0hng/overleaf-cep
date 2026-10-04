import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import VisualTableDragHandle from '@/features/visual-table-editor/components/visual-table-drag-handle'
import useTableReorder, {
  reorderedRangeStart,
  selectedReorderRange,
} from '@/features/visual-table-editor/hooks/use-table-reorder'

describe('Visual Table Editor reorder controls', function () {
  it('moves a complete selected axis and otherwise uses only the handle item', function () {
    const fullRows = {
      from: { row: 1, column: 0 },
      to: { row: 2, column: 3 },
    }

    expect(selectedReorderRange('rows', 2, fullRows, 5, 4)).to.deep.equal({
      from: 1,
      to: 2,
    })
    expect(selectedReorderRange('columns', 2, fullRows, 5, 4)).to.deep.equal({
      from: 2,
      to: 2,
    })
    expect(
      reorderedRangeStart({
        axis: 'rows',
        from: 1,
        to: 2,
        insertionIndex: 5,
      })
    ).to.equal(3)
  })

  it('exposes the drag handle and supports Alt plus the axis arrow keys', function () {
    const onKeyboardMove = sinon.stub()
    const onPointerDown = sinon.stub()

    render(
      <VisualTableDragHandle
        axis="columns"
        index={2}
        label="Drag column 3"
        onKeyboardMove={onKeyboardMove}
        onPointerDown={onPointerDown}
      />
    )

    const handle = screen.getByRole('button', { name: 'Drag column 3' })
    expect(handle.getAttribute('aria-keyshortcuts')).to.equal(
      'Alt+ArrowLeft Alt+ArrowRight'
    )
    fireEvent.mouseOver(handle)
    expect(screen.queryByRole('tooltip')).to.equal(null)

    fireEvent.keyDown(handle, { altKey: true, key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { altKey: true, key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 12, clientY: 20 })

    expect(onKeyboardMove).to.have.been.calledTwice
    expect(onKeyboardMove.firstCall.args).to.deep.equal(['columns', 2, -1])
    expect(onKeyboardMove.secondCall.args).to.deep.equal(['columns', 2, 1])
    expect(onPointerDown).to.have.been.calledOnce
  })

  it('reports an invalid target only after the user drops', function () {
    const onInvalidDrop = sinon.stub()
    const onDrop = sinon.stub()

    render(<ReorderHarness onDrop={onDrop} onInvalidDrop={onInvalidDrop} />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Drag row 2' }), {
      button: 0,
      clientX: 10,
      clientY: 50,
    })
    fireEvent.pointerMove(window, { clientX: 10, clientY: 100 })

    expect(onInvalidDrop).not.to.have.been.called

    fireEvent.pointerUp(window)
    expect(onInvalidDrop).to.have.been.calledOnceWith(
      'This move would split a merged cell.'
    )
    expect(onDrop).not.to.have.been.called
  })
})

function ReorderHarness({
  onDrop,
  onInvalidDrop,
}: {
  onDrop: () => void
  onInvalidDrop: (message: string) => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const reorder = useTableReorder({
    columnCount: 2,
    getError: () => 'This move would split a merged cell.',
    getRange: (_, index) => ({ from: index, to: index }),
    gridRef,
    onDrop,
    onInvalidDrop,
    rowCount: 3,
  })

  return (
    <div ref={gridRef}>
      <div className="vte-grid-body" />
      <button
        type="button"
        onPointerDown={event => reorder.beginReorder('rows', 1, event)}
      >
        Drag row 2
      </button>
    </div>
  )
}
