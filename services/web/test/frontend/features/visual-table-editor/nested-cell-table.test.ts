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

    expect(generated).to.contain('\\shortstack[c]{First \\\\ Second}')
    expect(generated).not.to.contain('\\begin{tabular}[c]')
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
    expect(generated).not.to.contain('\\begin{tabular}[c]')
    expect(generated).to.contain('\\shortstack[c]')
    expect(generated).to.contain('Alpha \\& Beta')
    expect(generated).to.contain('Gamma \\%')
  })

  it('unwraps nested table variants without exposing their layout arguments', function () {
    const variants = [
      { name: 'tabular', arguments: '[c]{@{}c@{}}' },
      { name: 'tabular*', arguments: '{\\linewidth}[c]{c}' },
      { name: 'tabularx', arguments: '{\\linewidth}[c]{X}' },
      { name: 'tabularx*', arguments: '{\\linewidth}[c]{X}' },
      { name: 'tabulary', arguments: '{\\linewidth}{C}' },
      { name: 'tabu', arguments: '{c}' },
      { name: 'longtabu', arguments: '{c}' },
      { name: 'tblr', arguments: '{colspec={c}}' },
      { name: 'longtblr', arguments: '{colspec={c}}' },
      { name: 'talltblr', arguments: '{colspec={c}}' },
      { name: 'xltabular', arguments: '{\\linewidth}{X}' },
      { name: 'longtable', arguments: '{c}' },
      { name: 'array', arguments: '{c}' },
      { name: 'NiceTabular', arguments: '[c]{c}' },
      { name: 'NiceTabularX', arguments: '{\\linewidth}[c]{X}' },
      { name: 'NiceArray', arguments: '[c]{c}' },
    ]

    for (const variant of variants) {
      const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{${variant.name}}${variant.arguments}Visible text\end{${variant.name}} & Tail \\
\end{tabular}`)
      const cell = cellAt(parsed.model, 0, 0)

      expect(cell?.content.text, variant.name).to.equal('Visible text')
      expect(cell?.content.rawLatex, variant.name).to.equal(undefined)
    }
  })

  it('flattens an array nested inside a math expression', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{c}
$\begin{array}{cc}\alpha & \beta\\\gamma & \delta\end{array}$ \\
\end{tabular}`)
    const generated = generateLatex(parsed.model).latex

    expect(cellAt(parsed.model, 0, 0)?.content.rawLatex).to.equal(
      '$\\alpha \\beta$\n$\\gamma \\delta$'
    )
    expect(generated).not.to.contain('\\begin{array}')
    expect(generated).to.contain('\\shortstack[c]')
  })

  it('supports the tabu width syntax when flattening a nested cell table', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabu} to \linewidth {c}Visible text\end{tabu} & Tail \\
\end{tabular}`)

    expect(cellAt(parsed.model, 0, 0)?.content.text).to.equal('Visible text')
  })

  it('keeps math and commands as raw LaTeX after removing the wrapper', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}[c]{@{}c@{}}Metric $\hat{z}_q$\end{tabular} & \begin{tabular}{c}State \ding{51}\end{tabular} \\
\end{tabular}`)
    const generated = generateLatex(parsed.model).latex

    expect(cellAt(parsed.model, 0, 0)?.content.rawLatex).to.equal(
      'Metric $\\hat{z}_q$'
    )
    expect(cellAt(parsed.model, 0, 1)?.content.rawLatex).to.equal(
      'State \\ding{51}'
    )
    expect(generated).not.to.contain('\\begin{tabular}[c]')
    expect(generated).to.contain('Metric $\\hat{z}_q$')
    expect(generated).to.contain('State \\ding{51}')
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

  it('flattens multi-column content and removes nested table rules', function () {
    const multiColumn = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{cc}A & B\\C & D\end{tabular} & Tail \\
\end{tabular}`)
    const ruled = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{c}\hline A\\B\end{tabular} & Tail \\
\end{tabular}`)

    expect(cellAt(multiColumn.model, 0, 0)?.content.text).to.equal('A B\nC D')
    expect(cellAt(ruled.model, 0, 0)?.content.text).to.equal('A\nB')
  })

  it('generates raw multiline content without restoring a nested table', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{c}
\begin{tabular}{c}Metric $\hat{x}$\\State \ding{51}\end{tabular} \\
\end{tabular}`)
    const cell = cellAt(parsed.model, 0, 0)
    const generated = generateLatex(parsed.model).latex
    const tableBegins = generated.match(/\\begin\{tabular\}/g) ?? []

    expect(cell?.content.rawLatex).to.equal(
      'Metric $\\hat{x}$\nState \\ding{51}'
    )
    expect(tableRowHeights(parsed.model)).to.deep.equal([62])
    expect(generated).to.contain(
      '\\shortstack[c]{Metric $\\hat{x}$ \\\\ State \\ding{51}}'
    )
    expect(tableBegins).to.have.lengthOf(1)
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
