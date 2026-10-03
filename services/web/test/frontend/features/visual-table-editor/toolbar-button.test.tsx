import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen } from '@testing-library/react'
import VisualTableToolbarButton, {
  VisualTableColorPicker,
} from '@/features/visual-table-editor/components/visual-table-toolbar-button'

describe('VisualTableToolbarButton', function () {
  it('renders an accessible icon button, tooltip, and active state', async function () {
    const onClick = sinon.stub()

    render(
      <VisualTableToolbarButton
        active
        tooltipId="test-toolbar-button"
        icon="undo"
        label="Undo"
        onClick={onClick}
      />
    )

    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button.getAttribute('aria-pressed')).to.equal('true')
    fireEvent.mouseOver(button.parentElement!)
    await screen.findByRole('tooltip', { name: 'Undo' })
    fireEvent.click(button)
    expect(onClick).to.have.been.calledOnce
  })

  it('keeps a disabled action labelled', function () {
    render(
      <VisualTableToolbarButton
        disabled
        tooltipId="test-disabled-toolbar-button"
        icon="redo"
        label="Redo"
        onClick={() => {}}
      />
    )

    const button = screen.getByRole('button', { name: 'Redo' })
    expect((button as HTMLButtonElement).disabled).to.be.true
  })
})

describe('VisualTableColorPicker', function () {
  it('shows its label and returns the selected color', function () {
    const onChange = sinon.stub()

    render(
      <VisualTableColorPicker
        tooltipId="test-color-picker"
        icon="format_color_text"
        label="Text color"
        onChange={onChange}
      />
    )

    fireEvent.change(screen.getByLabelText('Text color'), {
      target: { value: '#123456' },
    })
    expect(onChange).to.have.been.calledWith('#123456')
  })
})
