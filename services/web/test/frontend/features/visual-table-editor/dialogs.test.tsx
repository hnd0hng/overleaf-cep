import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen } from '@testing-library/react'
import VisualTableConfirmationDialog from '@/features/visual-table-editor/components/visual-table-confirmation-dialog'
import VisualTablePasteSpecialDialog from '@/features/visual-table-editor/components/visual-table-paste-special-dialog'

describe('Visual table editor dialogs', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('returns paste-special input through the Overleaf form dialog', function () {
    const onPaste = sinon.stub()
    render(
      <VisualTablePasteSpecialDialog
        show
        themed={false}
        onCancel={() => {}}
        onPaste={onPaste}
      />
    )

    fireEvent.change(screen.getByLabelText('Table text'), {
      target: { value: 'Alpha;Beta' },
    })
    fireEvent.change(screen.getByLabelText('Split cells by'), {
      target: { value: 'semicolon' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))

    expect(onPaste).to.have.been.calledOnceWith('Alpha;Beta', 'semicolon', '')
  })

  it('requires an explicit confirmation', function () {
    const onCancel = sinon.stub()
    const onConfirm = sinon.stub()
    render(
      <VisualTableConfirmationDialog
        show
        themed={false}
        title="Confirm change"
        message="Review the change before continuing."
        confirmLabel="Continue"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onConfirm).to.have.been.calledOnce
    expect(onCancel).not.to.have.been.called
  })
})
