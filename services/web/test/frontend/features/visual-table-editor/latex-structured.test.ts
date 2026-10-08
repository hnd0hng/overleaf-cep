import {
  generateLatex,
  parseLatexTable,
} from '@/features/visual-table-editor/latex'
import { cellAt, updateCellText } from '@/features/visual-table-editor/model'
import { expect } from 'chai'

const latex = String.raw

describe('Visual Table Editor structured LaTeX pipeline', function () {
  it('generates canonical LaTeX from the imported semantic model', function () {
    const source = latex`\begin{tabular}{|c|c|}
\hline
Alpha & Beta \\ \hline
\end{tabular}`
    const parsed = parseLatexTable(source)

    const canonical = generateLatex(parsed.model).latex
    expect(canonical).to.contain('Alpha & Beta')
    expect(canonical).to.contain('\\hline')
    expect(parseLatexTable(canonical).unsafe).to.equal(false)

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

  it('removes layout rules while flattening a nested cell environment', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
\begin{tabular}{c}\hline Inner \\ \hline\end{tabular} & Outer \\
\end{tabular}`)

    expect(cellAt(parsed.model, 0, 0)?.content.text).to.equal('Inner')
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

  it('canonicalizes approved custom columns to supported columns', function () {
    const source = latex`\begin{tabular}{L{2cm}C{3cm}S[table-format=2.1]}
Left & Center & 3.2 \\
\end{tabular}`
    const parsed = parseLatexTable(source, true)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )
    const generated = generateLatex(edited).latex

    expect(parsed.model.columns.map(column => column.alignment)).to.deep.equal([
      'left',
      'center',
      'center',
    ])
    expect(parsed.model.columns[0].width).to.deep.equal({
      mode: 'fixed',
      value: 2,
      unit: 'cm',
    })
    expect(generated).to.contain('p{2cm}')
    expect(generated).to.contain('p{3cm}')
    expect(generated).not.to.contain('L{2cm}')
    expect(generated).not.to.contain('S[table-format=2.1]')
  })

  it('warns and removes unsupported cmidrule trim options', function () {
    const source = latex`\begin{tabular}{ccc}
Head A & Head B & Head C \\ \cmidrule(lr){2-3}
Body A & Body B & Body C \\
\end{tabular}`
    const warning = parseLatexTable(source)
    const parsed = parseLatexTable(source, true)
    const edited = updateCellText(
      parsed.model,
      { row: 1, column: 0 },
      'Changed body'
    )
    const generated = generateLatex(edited).latex

    expect(warning.unsafe).to.equal(true)
    expect(cellAt(parsed.model, 1, 0)?.content.text).to.equal('Body A')
    expect(generated).to.contain('\\cmidrule{2-3}')
    expect(generated).not.to.contain('\\cmidrule(lr)')
    expect(generated).not.to.contain('(lr){2-3}Body')
  })

  it('keeps makecell alignment when multiline content is edited', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{c}
\makecell[l]{First \\ Second} \\
\end{tabular}`)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed one\nChanged two'
    )

    expect(cellAt(parsed.model, 0, 0)?.horizontalAlignment).to.equal('left')
    expect(generateLatex(edited).latex).to.contain('\\makecell[l]')
  })

  it('preserves row colors and source fixed-width columns on content edits', function () {
    const source = latex`\begin{tabular}{p{2cm}c}
\rowcolor{gray!20} Alpha & Beta \\
\end{tabular}`
    const parsed = parseLatexTable(source, true)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 1 },
      'Changed'
    )
    const generated = generateLatex(edited)

    expect(parsed.model.rows[0].backgroundColor).to.equal('gray!20')
    expect(generated.latex).to.contain('\\begin{tabular}{p{2cm}c}')
    expect(generated.latex).to.contain('\\rowcolor{gray!20}')
    expect(generated.latex).not.to.contain('\\raggedright')
    expect(generated.packages).to.include('xcolor[table]')
  })

  it('warns before dropping unsupported transparent outer wrappers', function () {
    const source = latex`\begin{landscape}
\begin{table}[p]
\caption{Synthetic wrapped table}
\begin{tabular}{cc}
Alpha & Beta \\
\end{tabular}
\label{tab:synthetic-wrapped}
\end{table}
\end{landscape}`
    const warning = parseLatexTable(source)
    const parsed = parseLatexTable(source, true)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )
    edited.options.caption = 'Updated wrapped table'
    const generated = generateLatex(edited).latex

    expect(warning.unsafe).to.equal(true)
    expect(generated).not.to.contain('\\begin{landscape}')
    expect(generated).to.contain('\\caption{Updated wrapped table}')
    expect(generated).not.to.contain('\\end{landscape}')
  })
  it('rebuilds a bordered merged table without redundant one-column wrappers', function () {
    const source = [
      '\\begin{table}[H]',
      '\\centering',
      '\\begin{tabular}{|c|c|c|c|c|c|}',
      '\\hline',
      '\\multirow{2}{*}{Item} & \\multicolumn{2}{c|}{Quality} & \\multicolumn{2}{c|}{Resources} & \\multirow{2}{*}{Order} \\\\',
      '\\cline{2-5}',
      '& Metric A & Metric B & Duration & Capacity & \\\\',
      '\\hline',
      'Entry A & 0.8 & 0.7 & 1.1 & 128 & 1 \\\\',
      'Entry B & 0.7 & 0.6 & 0.9 & 96 & 2 \\\\',
      '\\hline',
      '\\end{tabular}',
      '\\label{tab:synthetic-merged}',
      '\\end{table}',
    ].join('\n')
    const parsed = parseLatexTable(source)
    const generated = generateLatex(parsed.model).latex
    const reparsed = parseLatexTable(generated)

    expect(parsed.unsafe).to.equal(false)
    expect(generated).to.contain('\\begin{table}[H]')
    expect(generated).to.contain('\\begin{tabular}{|c|c|c|c|c|c|}')
    expect(generated).not.to.contain('m{3cm}')
    expect(generated).not.to.contain('\\multicolumn{1}')
    expect(cellAt(reparsed.model, 0, 0)).to.deep.include({ rowSpan: 2 })
    expect(cellAt(reparsed.model, 0, 1)).to.deep.include({ columnSpan: 2 })
    expect(cellAt(reparsed.model, 0, 3)).to.deep.include({ columnSpan: 2 })
    expect(cellAt(reparsed.model, 0, 5)).to.deep.include({ rowSpan: 2 })
  })
})
