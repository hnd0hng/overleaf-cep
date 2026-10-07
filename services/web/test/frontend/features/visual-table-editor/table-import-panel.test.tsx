import { expect } from 'chai'
import sinon from 'sinon'
import { fireEvent, render, screen, within } from '@testing-library/react'
import VisualTableImportPanel from '@/features/visual-table-editor/components/visual-table-import-panel'

describe('VisualTableImportPanel', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('previews CSV text and returns a replacement model', async function () {
    const onImport = sinon.stub()
    render(<VisualTableImportPanel onCancel={() => {}} onImport={onImport} />)

    fireEvent.change(screen.getByLabelText('Table text'), {
      target: { value: 'A,B\nC,D' },
    })
    await screen.findByText('2 rows × 2 columns', { exact: false })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(onImport).to.have.been.calledOnce
    expect(onImport.firstCall.args[0].rows).to.have.length(2)
    expect(onImport.firstCall.args[0].columns).to.have.length(2)
  })

  it('reports an incomplete LaTeX fragment without importing', async function () {
    const onImport = sinon.stub()
    render(<VisualTableImportPanel onCancel={() => {}} onImport={onImport} />)

    fireEvent.change(screen.getByLabelText('Format'), {
      target: { value: 'latex' },
    })
    fireEvent.change(screen.getByLabelText('Table text'), {
      target: { value: String.raw`A & B \\` },
    })
    await screen.findByRole('alert')
    expect(
      (screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement)
        .disabled
    ).to.equal(true)
    expect(onImport).not.to.have.been.called
  })

  it('requires two acknowledgements for unsafe LaTeX', async function () {
    const onImport = sinon.stub()
    render(<VisualTableImportPanel onCancel={() => {}} onImport={onImport} />)

    fireEvent.change(screen.getByLabelText('Table text'), {
      target: {
        value: String.raw`\begin{tabular}{cc}
A & B \\ \specialrule{1pt}{0pt}{0pt}
C & D \\
\end{tabular}`,
      },
    })
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Continue with unsafe import',
      })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Import anyway' })
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Import anyway' })
    )

    expect(onImport).to.have.been.calledOnce
    expect(onImport.firstCall.args[0].unsafeImport).to.equal(true)
  })

  it('cancels without importing', function () {
    const onCancel = sinon.stub()
    const onImport = sinon.stub()
    render(<VisualTableImportPanel onCancel={onCancel} onImport={onImport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).to.have.been.calledOnce
    expect(onImport).not.to.have.been.called
  })

  it('automatically detects complete LaTeX input', async function () {
    render(<VisualTableImportPanel onCancel={() => {}} onImport={() => {}} />)

    fireEvent.change(screen.getByLabelText('Table text'), {
      target: {
        value: String.raw`\begin{tabular}{cc}
A & B \\
\end{tabular}`,
      },
    })

    expect(
      (screen.getByLabelText('Format') as HTMLSelectElement).value
    ).to.equal('latex')
    expect(screen.queryByLabelText('Delimiter')).to.equal(null)
    await screen.findByText('1 rows × 2 columns', { exact: false })
  })

  it('renders imported row and column spans in the preview', async function () {
    const { container } = render(
      <VisualTableImportPanel onCancel={() => {}} onImport={() => {}} />
    )
    const source = String.raw`\begin{tabular}{|c|c|c|c|c|}
\hline
\multicolumn{5}{|c|}{\textbf{Masked heading}} \\
\hline
\multirow{2}{*}{A} & B & \multicolumn{2}{c|}{C-D} & E \\
\cline{2-5}
& F & G & H & I \\
\hline
\multirow{2}{*}{J-K} & \multicolumn{2}{c|}{L-M} & N & O \\
\cline{2-5}
& P & Q & \multicolumn{2}{c|}{R-S} \\
\hline
\end{tabular}`

    fireEvent.change(screen.getByLabelText('Table text'), {
      target: { value: source },
    })
    await screen.findByText('5 rows × 5 columns', { exact: false })

    const cells = container.querySelectorAll('.vte-import-preview-table td')
    expect(cells).to.have.length(16)
    expect(
      container.querySelectorAll('.vte-import-preview-table td[rowspan="2"]')
    ).to.have.length(2)
    expect(
      container.querySelectorAll('.vte-import-preview-table td[colspan="2"]')
    ).to.have.length(3)
    expect(
      container.querySelector('.vte-import-preview-table td[colspan="5"]')
        ?.textContent
    ).to.equal('Masked heading')
  })

  it('keeps a manual format selection until the source is cleared', function () {
    render(<VisualTableImportPanel onCancel={() => {}} onImport={() => {}} />)
    const format = screen.getByLabelText('Format') as HTMLSelectElement
    const source = screen.getByLabelText('Table text')
    const latex = String.raw`\begin{tabular}{c}
A \\
\end{tabular}`

    fireEvent.change(format, { target: { value: 'latex' } })
    fireEvent.change(source, { target: { value: 'A,B' } })
    expect(format.value).to.equal('latex')

    fireEvent.change(source, { target: { value: '' } })
    expect(format.value).to.equal('latex')
    fireEvent.change(source, { target: { value: 'A,B' } })
    expect(format.value).to.equal('csv')
    fireEvent.change(source, { target: { value: latex } })
    expect(format.value).to.equal('latex')
  })
})
