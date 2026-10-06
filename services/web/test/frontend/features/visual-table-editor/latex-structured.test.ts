import {
  generateLatex,
  parseLatexTable,
} from '@/features/visual-table-editor/latex'
import { cellAt, updateCellText } from '@/features/visual-table-editor/model'
import { expect } from 'chai'

const latex = String.raw

describe('Visual Table Editor structured LaTeX pipeline', function () {
  it('preserves unchanged source and canonicalizes only after an edit', function () {
    const source = latex`\begin{tabular}{|c|c|}
\hline
Alpha & Beta \\ \hline
\end{tabular}`
    const parsed = parseLatexTable(source)

    expect(generateLatex(parsed.model).latex).to.equal(source)

    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )
    const generated = generateLatex(edited).latex
    expect(generated).to.contain('Changed')
    expect(generated).to.match(/^\\begin\{tabular\}/)
    expect(generated).not.to.contain('\\begin{table}')
  })

  it('keeps separators scoped inside groups, math, comments, and nested tables', function () {
    const source = latex`\begin{tabular}{cc}
\textbf{A & B} & $x & y$ \\
\begin{tabular}{c}Inner \\ Value\end{tabular} & Tail % ignored & marker
\\
\end{tabular}`
    const parsed = parseLatexTable(source)

    expect(parsed.model.rows).to.have.length(2)
    expect(parsed.model.columns).to.have.length(2)
    expect(cellAt(parsed.model, 0, 0)?.content.text).to.equal('A & B')
    expect(cellAt(parsed.model, 0, 1)?.content.rawLatex).to.equal('$x & y$')
    expect(cellAt(parsed.model, 1, 0)?.content.text).to.equal('Inner\nValue')
    expect(cellAt(parsed.model, 1, 1)?.content.text).to.equal('Tail')
  })

  it('expands repeated column definitions without losing alignment', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{*{2}{l}r}
A & B & C \\
\end{tabular}`)

    expect(parsed.unsafe).to.equal(false)
    expect(parsed.model.columns.map(column => column.alignment)).to.deep.equal([
      'left',
      'left',
      'right',
    ])
  })

  it('supports optional and negative multirow arguments', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
 & Upper \\
\multirow[b]{-2}[0]{*}[0pt]{Spanning} & Lower \\
\end{tabular}`)

    expect(parsed.unsafe).to.equal(false)
    expect(cellAt(parsed.model, 0, 0)).to.deep.include({
      row: 0,
      rowSpan: 2,
    })
    expect(cellAt(parsed.model, 0, 0)?.content.text).to.equal('Spanning')
    expect(cellAt(parsed.model, 1, 1)?.content.text).to.equal('Lower')
  })

  it('imports makecell content as editable multiline text', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{c}
\makecell[l]{Line A \\ Line B} \\
\end{tabular}`)

    expect(cellAt(parsed.model, 0, 0)?.content.text).to.equal('Line A\nLine B')
    expect(generateLatex(parsed.model).packages).to.include('makecell')
  })

  it('does not remove rules inside a nested cell environment', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{c}\hline Inner \\ \hline\end{tabular} & Outer \\
\end{tabular}`)

    expect(cellAt(parsed.model, 0, 0)?.content.rawLatex).to.contain('\\hline')
    expect(cellAt(parsed.model, 0, 1)?.content.text).to.equal('Outer')
  })

  it('requires unsafe approval for approximated custom column types', function () {
    const source = latex`\begin{tabular}{Sc}
1.5 & Value \\
\end{tabular}`
    const warning = parseLatexTable(source)
    const accepted = parseLatexTable(source, true)

    expect(warning.unsafe).to.equal(true)
    expect(
      warning.diagnostics.some(item => item.message.includes('type S'))
    ).to.equal(true)
    expect(accepted.model.columns).to.have.length(2)
    expect(accepted.model.unsafeImport).to.equal(true)
  })
})
