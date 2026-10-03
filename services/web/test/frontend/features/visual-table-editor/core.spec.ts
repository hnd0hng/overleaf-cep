import {
  assertModel,
  cellAt,
  deleteColumns,
  deleteRows,
  insertColumn,
  insertRow,
  mergeSelection,
  pasteMatrix,
  splitSelection,
  transpose,
  updateCellText,
} from '@/features/visual-table-editor/model'
import {
  escapeLatex,
  generateLatex,
  parseLatexTable,
} from '@/features/visual-table-editor/latex'
import { proposePackages } from '@/features/visual-table-editor/packages'
import { createTableModel } from '@/features/visual-table-editor/types'
import { expect } from 'chai'

describe('Visual Table Editor core', function () {
  it('merges and splits rectangular selections', function () {
    const selection = {
      from: { row: 0, column: 0 },
      to: { row: 1, column: 1 },
    }
    const merged = mergeSelection(createTableModel(3, 3), selection)
    expect(cellAt(merged, 0, 0)).to.deep.include({
      rowSpan: 2,
      columnSpan: 2,
    })
    expect(cellAt(merged, 1, 1)?.id).to.equal(cellAt(merged, 0, 0)?.id)
    const split = splitSelection(merged, selection)
    expect(Object.values(split.cells)).to.have.length(9)
    expect(() => assertModel(split)).not.to.throw()
  })

  it('preserves occupancy through structural operations and transpose', function () {
    let model = createTableModel(3, 3)
    model = insertRow(model, 1)
    model = insertColumn(model, 2)
    model = deleteRows(model, 0, 0)
    model = deleteColumns(model, 0, 0)
    model = transpose(model)
    expect(model.rows).to.have.length(3)
    expect(model.columns).to.have.length(3)
    expect(() => assertModel(model)).not.to.throw()
  })

  it('supports a 100,000-cell paste acceptance target', function () {
    this.timeout(30_000)
    const matrix = Array.from({ length: 1000 }, (_, row) =>
      Array.from({ length: 100 }, (_, column) => `${row}:${column}`)
    )
    const model = pasteMatrix(
      createTableModel(1, 1),
      { row: 0, column: 0 },
      matrix
    )
    expect(model.rows).to.have.length(1000)
    expect(model.columns).to.have.length(100)
    expect(cellAt(model, 999, 99)?.content.text).to.equal('999:99')
  })

  it('escapes literal TeX and generates deterministic merged output', function () {
    expect(escapeLatex('&%$#_{}~^\\')).to.equal(
      '\\&\\%\\$\\#\\_\\{\\}\\textasciitilde{}\\textasciicircum{}\\textbackslash{}'
    )
    let model = createTableModel(2, 2)
    model = updateCellText(model, { row: 0, column: 0 }, 'A\nB')
    model = mergeSelection(model, {
      from: { row: 1, column: 0 },
      to: { row: 1, column: 1 },
    })
    model.options.style = 'booktabs'
    const first = generateLatex(model)
    expect(generateLatex(model)).to.deep.equal(first)
    expect(first.latex).to.contain('\\shortstack[c]{A \\\\ B}')
    expect(first.latex).to.contain('\\multicolumn{2}{c}')
    expect(first.packages).to.include('booktabs')
    expect(first.latex).not.to.contain('{|c|}')
  })

  it('parses tabularx, multicolumn, multirow, caption and labels', function () {
    const result = parseLatexTable(String.raw`\begin{table}
\centering
\begin{tabularx}{\textwidth}{lXr}
\multicolumn{2}{c}{Heading} & Z \\
\multirow{2}{*}{A} & B & C \\
 & D & E \\
\end{tabularx}
\caption{Results}
\label{tab:results}
\end{table}`)
    expect(result.unsafe).to.equal(false)
    expect(result.model.options.environment).to.equal('tabularx')
    expect(result.model.options.caption).to.equal('Results')
    expect(result.model.columns[1].width.mode).to.equal('flex')
    expect(cellAt(result.model, 0, 0)).to.deep.include({ columnSpan: 2 })
    expect(cellAt(result.model, 1, 0)).to.deep.include({ rowSpan: 2 })
  })

  it('warns before unsafe import and preserves opaque cell LaTeX', function () {
    const unsafe = parseLatexTable(String.raw`\begin{tabular}{cc}
A & B \\ \cmidrule{1-2}
C & D \\
\end{tabular}`)
    expect(unsafe.unsafe).to.equal(true)
    const parsed = parseLatexTable(String.raw`\begin{tabular}{c}
\textcolor{red}{A} \\
\end{tabular}`)
    expect(cellAt(parsed.model, 0, 0)?.content.rawLatex).to.equal(
      String.raw`\textcolor{red}{A}`
    )
    expect(generateLatex(parsed.model).latex).to.contain(
      String.raw`\textcolor{red}{A}`
    )
  })

  it('round-trips supported horizontal and vertical borders', function () {
    const parsed = parseLatexTable(String.raw`\begin{tabular}{|c|c|}
\hline
A & B \\ \cline{1-1}
C & D \\
\hline
\end{tabular}`)
    expect(parsed.unsafe).to.equal(false)
    expect(cellAt(parsed.model, 0, 0)?.borders).to.deep.include({
      top: 'solid',
      left: 'solid',
      right: 'solid',
    })
    expect(cellAt(parsed.model, 1, 0)?.borders).to.deep.include({
      top: 'solid',
      bottom: 'solid',
    })
    const generated = generateLatex(parsed.model).latex
    expect(generated).to.contain('\\hline')
    expect(generated).to.contain('\\cline{1-1}')
    expect(generated).to.contain('\\multicolumn{1}{|c|}{A}')
  })

  it('does not duplicate repeated longtable header rows in the body', function () {
    const model = createTableModel(2, 2)
    model.options.environment = 'longtable'
    model.rows[0].repeatOnNewPage = true
    const latex = generateLatex(
      updateCellText(model, { row: 0, column: 0 }, 'UniqueHeader')
    ).latex
    expect(latex.match(/UniqueHeader/g)).to.have.length(2)
    expect(latex).to.contain('\\endfirsthead')
    expect(latex).to.contain('\\endhead')
  })

  it('finds included packages and proposes exact insertion or option updates', function () {
    const main = {
      path: 'main.tex',
      source: String.raw`\documentclass{article}
\usepackage{xcolor}
\input{preamble}
\begin{document}`,
    }
    const proposals = proposePackages(
      ['booktabs', 'xcolor[table]', 'multirow'],
      main,
      [
        main,
        { path: 'preamble.tex', source: String.raw`\usepackage{booktabs}` },
      ]
    )
    expect(proposals[0].status).to.equal('present')
    expect(proposals[1]).to.deep.include({ status: 'update-options' })
    expect(proposals[1].location).to.deep.include({
      file: 'main.tex',
      line: 2,
    })
    expect(proposals[2]).to.deep.include({ status: 'insert' })
  })
})
