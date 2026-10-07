import {
  generateLatex,
  parseLatexTable,
} from '@/features/visual-table-editor/latex'
import { cellAt, updateCellText } from '@/features/visual-table-editor/model'
import {
  tableCellHeight,
  tableRowHeights,
} from '@/features/visual-table-editor/row-layout'
import { expect } from 'chai'

const latex = String.raw

describe('Visual Table Editor nested cell tables', function () {
  it('imports a decorated one-column tabular as editable multiline text', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\textbf{\begin{tabular}[c]{@{}l@{}}Primary\\Secondary\end{tabular}} & Value \\
\end{tabular}`)
    const cell = cellAt(parsed.model, 0, 0)

    expect(parsed.unsafe).to.equal(false)
    expect(cell?.content).to.deep.include({
      text: 'Primary\nSecondary',
      style: { bold: true },
    })
    expect(cell?.content.rawLatex).to.equal(undefined)
    expect(cell?.horizontalAlignment).to.equal('left')
  })

  it('keeps multirow semantics while unwrapping centered multiline text', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{lc}
\multirow{2}{*}{\begin{tabular}[c]{@{}c@{}}Upper\\Lower\end{tabular}} & A \\
& B \\
\end{tabular}`)
    const cell = cellAt(parsed.model, 0, 0)

    expect(cell).to.deep.include({ rowSpan: 2, horizontalAlignment: 'center' })
    expect(cell?.content.text).to.equal('Upper\nLower')
  })

  it('generates equivalent multiline LaTeX after the imported table is edited', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}[c]{@{}c@{}}First\\Second\end{tabular} & Before \\
\end{tabular}`)
    const edited = updateCellText(parsed.model, { row: 0, column: 1 }, 'After')
    const generated = generateLatex(edited).latex

    expect(generated).to.contain('\\begin{tabular}[c]{@{}c@{}}')
  })

  it('imports safe escaped characters and escapes them again after an edit', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}[c]{@{}c@{}}Alpha \& Beta\\Gamma \%\end{tabular} & Before \\
\end{tabular}`)
    const cell = cellAt(parsed.model, 0, 0)

    expect(cell?.content.text).to.equal('Alpha & Beta\nGamma %')
    expect(cell?.content.rawLatex).to.equal(undefined)

    const edited = updateCellText(parsed.model, { row: 0, column: 1 }, 'After')
    const generated = generateLatex(edited).latex
    expect(generated).to.contain('\\begin{tabular}[c]{@{}c@{}}')
    expect(generated).to.contain('Alpha \\& Beta')
    expect(generated).to.contain('Gamma \\%')
  })

  it('continues to display citations and math as raw LaTeX', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
Author \cite{masked-reference} & Score $\hat{x}$ \\
\end{tabular}`)

    expect(cellAt(parsed.model, 0, 0)?.content.rawLatex).to.equal(
      'Author \\cite{masked-reference}'
    )
    expect(cellAt(parsed.model, 0, 1)?.content.rawLatex).to.equal(
      'Score $\\hat{x}$'
    )
  })

  it('keeps multi-column and ruled nested tables opaque', function () {
    const multiColumn = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{cc}A & B\end{tabular} & Tail \\
\end{tabular}`)
    const ruled = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{c}\hline A\\B\end{tabular} & Tail \\
\end{tabular}`)

    expect(cellAt(multiColumn.model, 0, 0)?.content.rawLatex).to.contain(
      '\\begin{tabular}'
    )
    expect(cellAt(ruled.model, 0, 0)?.content.rawLatex).to.contain('\\hline')
  })

  it('allocates enough editor height for multiline and merged cells', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{c}One\\Two\end{tabular} & \multirow{2}{*}{Tall} \\
Next & \\
\end{tabular}`)
    const heights = tableRowHeights(parsed.model)

    expect(heights).to.deep.equal([62, 42])
    expect(tableCellHeight(heights, 0, 2)).to.equal(102)
  })
})
