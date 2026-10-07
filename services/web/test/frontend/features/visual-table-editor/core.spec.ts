import {
  applyBorders,
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

  it('preserves anchor formatting and outer borders through merge and split', function () {
    const model = createTableModel(2, 2)
    const anchor = cellAt(model, 0, 0)!
    anchor.content.text = 'Masked'
    anchor.content.style = { bold: true, color: '#123456' }
    anchor.backgroundColor = '#abcdef'
    anchor.horizontalAlignment = 'right'
    anchor.verticalAlignment = 'middle'
    anchor.numberFormat = {
      precision: 2,
      thousandsSeparator: true,
      decimalSeparator: '.',
    }

    const selection = {
      from: { row: 0, column: 0 },
      to: { row: 1, column: 1 },
    }
    const merged = mergeSelection(model, selection)
    const mergedCell = cellAt(merged, 0, 0)!
    expect(mergedCell.content.style).to.deep.equal(anchor.content.style)
    expect(mergedCell.backgroundColor).to.equal('#abcdef')
    expect(mergedCell.horizontalAlignment).to.equal('right')
    expect(mergedCell.verticalAlignment).to.equal('middle')
    expect(mergedCell.numberFormat).to.deep.equal(anchor.numberFormat)
    expect(mergedCell.borders).to.deep.equal({
      top: 'solid',
      right: 'solid',
      bottom: 'solid',
      left: 'solid',
    })

    const split = splitSelection(merged, selection)
    expect(cellAt(split, 0, 0)?.content.style).to.deep.equal(
      anchor.content.style
    )
    expect(
      Object.values(split.cells).every(
        cell => cell.backgroundColor === '#abcdef'
      )
    ).to.equal(true)
    expect(cellAt(split, 0, 0)?.borders).to.deep.include({
      top: 'solid',
      left: 'solid',
    })
    expect(cellAt(split, 1, 1)?.borders).to.deep.include({
      right: 'solid',
      bottom: 'solid',
    })
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
    const generated = generateLatex(model)
    expect(generated.latex).to.contain('999:99')
    expect(generated.latex.split('\n')).to.have.length.greaterThan(1000)
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
    model = applyBorders(
      model,
      { from: { row: 0, column: 0 }, to: { row: 1, column: 1 } },
      'none'
    )
    model.options.style = 'booktabs'
    const first = generateLatex(model)
    expect(generateLatex(model)).to.deep.equal(first)
    expect(first.latex).to.contain('\\shortstack[c]{A \\\\ B}')
    expect(first.latex).to.contain('\\multicolumn{2}{c}')
    expect(first.packages).to.include('booktabs')
    expect(first.latex).not.to.contain('{|c|}')
  })

  it('uses only the strongest xcolor package requirement', function () {
    const model = createTableModel(1, 2)
    const cells = Object.values(model.cells)
    cells[0].content.style = { color: '#123456' }
    cells[1].backgroundColor = '#abcdef'

    const generated = generateLatex(model)

    expect(generated.packages).to.include('xcolor[table]')
    expect(generated.packages).not.to.include('xcolor')
    expect(
      generated.packages.filter(item => item.startsWith('xcolor'))
    ).to.have.length(1)
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

  it('matches the outer table ending when a cell contains a nested table', function () {
    const source = [
      '\\begin{tabular}{cc}',
      '\\textbf{\\begin{tabular}{c}Inner\\\\Heading\\end{tabular}} & Score \\\\',
      'Entry & 4 \\\\',
      '\\end{tabular}',
    ].join('\n')
    const result = parseLatexTable(source)

    expect(result.unsafe).to.equal(false)
    expect(result.model.rows).to.have.length(2)
    expect(result.model.columns).to.have.length(2)
    expect(cellAt(result.model, 0, 0)?.content).to.deep.include({
      text: 'Inner\nHeading',
      style: { bold: true },
    })
    expect(cellAt(result.model, 1, 1)?.content.text).to.equal('4')
  })

  it('warns before unsafe import and preserves opaque cell LaTeX', function () {
    const unsafe = parseLatexTable(String.raw`\begin{tabular}{cc}
A & B \\ \specialrule{1pt}{0pt}{0pt}
C & D \\
\end{tabular}`)
    expect(unsafe.unsafe).to.equal(true)
    const parsed = parseLatexTable(String.raw`\begin{tabular}{c}
\textcolor{red}{A} \\
\end{tabular}`)
    expect(cellAt(parsed.model, 0, 0)?.content).to.deep.include({
      text: 'A',
      style: { color: 'red' },
    })
    expect(generateLatex(parsed.model).latex).to.contain(
      String.raw`\textcolor{red}{A}`
    )
  })

  it('round-trips supported horizontal and vertical borders', function () {
    const source = String.raw`\begin{tabular}{|c|c|}
\hline
A & B \\ \cline{1-1}
C & D \\
\hline
\end{tabular}`
    const parsed = parseLatexTable(source)
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
    const canonical = generateLatex(parsed.model).latex
    expect(canonical).to.contain('\\begin{tabular}{|c|c|}')
    expect(canonical).to.contain('\\cline{1-1}')
    expect(parseLatexTable(canonical).unsafe).to.equal(false)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )
    const generated = generateLatex(edited).latex
    expect(generated).to.contain('\\hline')
    expect(generated).to.contain('\\cline{1-1}')
    expect(generated).to.contain('\\begin{tabular}{|c|c|}')
    expect(generated).to.contain('Changed & B')
    expect(generated).not.to.contain('\\multicolumn{1}')
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

  it('combines adjacent clines without drawing through a row span', function () {
    const partial = parseLatexTable(
      [
        '\\begin{tabular}{ccc}',
        'A & B & C \\\\ \\cline{2-3}',
        'D & E & F \\\\',
        '\\end{tabular}',
      ].join('\n')
    )
    expect(generateLatex(partial.model).latex).to.contain('\\cline{2-3}')

    const merged = parseLatexTable(
      [
        '\\begin{tabular}{|c|c|c|}',
        '\\hline',
        '\\multicolumn{2}{|c|}{\\multirow{2}{*}{Block}} & A \\\\ \\cline{3-3}',
        ' & & B \\\\ \\hline',
        '\\end{tabular}',
      ].join('\n')
    )
    const generated = generateLatex(merged.model).latex
    expect(generated).to.contain('\\cline{3-3}')
    expect(generated.match(/\\hline/g)).to.have.length(2)
  })
})
