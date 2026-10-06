import {
  generateLatex,
  parseLatexTable,
} from '@/features/visual-table-editor/latex'
import {
  deleteRows,
  getRowMoveError,
  insertRow,
  mergeSelection,
  updateCellText,
} from '@/features/visual-table-editor/model'
import { parseLatexImport } from '@/features/visual-table-editor/table-import'
import { expect } from 'chai'

const latex = String.raw

describe('Visual Table Editor extended LaTeX environments', function () {
  it('keeps a table* wrapper and metadata on their original sides', function () {
    const source = latex`\begin{table*}[!t]
\label{tab:synthetic-wide}
\begin{tabular}{cc}
Alpha & Beta \\
\end{tabular}
\caption{Synthetic wide table}
\end{table*}`
    const parsed = parseLatexTable(source)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )
    edited.options.caption = 'Updated synthetic caption'
    const generated = generateLatex(edited).latex

    expect(generated).to.contain('\\begin{table*}[!t]')
    expect(generated).to.contain('\\caption{Updated synthetic caption}')
    expect(generated).to.contain('\\end{table*}')
    expect(generated.indexOf('\\label')).to.be.lessThan(
      generated.indexOf('\\begin{tabular}')
    )
    expect(generated.indexOf('\\caption')).to.be.greaterThan(
      generated.indexOf('\\end{tabular}')
    )
  })

  it('keeps sidewaystable* and requests the rotating package', function () {
    const source = latex`\begin{sidewaystable*}[p]
\caption{Rotated synthetic table}
\begin{tabular}{c}
Value \\
\end{tabular}
\label{tab:rotated-synthetic}
\end{sidewaystable*}`
    const parsed = parseLatexImport(source)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Updated'
    )
    const generated = generateLatex(edited)

    expect(generated.latex).to.contain('\\begin{sidewaystable*}[p]')
    expect(generated.latex.indexOf('\\caption')).to.be.lessThan(
      generated.latex.indexOf('\\begin{tabular}')
    )
    expect(generated.latex.indexOf('\\label')).to.be.greaterThan(
      generated.latex.indexOf('\\end{tabular}')
    )
    expect(generated.packages).to.include('rotating')
  })

  it('imports and regenerates tabular* arguments', function () {
    const source = latex`\begin{tabular*}{0.8\textwidth}[t]{lr}
Left & Right \\
\end{tabular*}`
    const parsed = parseLatexTable(source)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 1 },
      'Changed'
    )
    const generated = generateLatex(edited).latex

    expect(parsed.model.options.environment).to.equal('tabular*')
    expect(parsed.model.options.targetWidth).to.equal('0.8\\textwidth')
    expect(parsed.model.options.environmentPosition).to.equal('t')
    expect(generated).to.contain('\\begin{tabular*}{0.8\\textwidth}[t]{lr}')
  })

  it('imports xltabular and requests its package after an edit', function () {
    const source = latex`\begin{xltabular}{\textwidth}{Xr}
Flexible & 1 \\
\end{xltabular}`
    const parsed = parseLatexTable(source)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Updated'
    )
    const generated = generateLatex(edited)

    expect(parsed.model.options.environment).to.equal('xltabular')
    expect(generated.latex).to.contain('\\begin{xltabular}{\\textwidth}{Xr}')
    expect(generated.packages).to.include('xltabular')
  })

  it('retains every longtable section and anchored metadata', function () {
    const source = latex`\begin{longtable}[c]{cc}
\caption[Short synthetic]{Synthetic long table}\label{tab:synthetic-long} \\
First A & First B \\
\endfirsthead
Head A & Head B \\
\endhead
Foot A & Foot B \\
\endfoot
\caption*{Last-page note} \\
Last A & Last B \\
\endlastfoot
Body A & Body B \\
\end{longtable}`
    const parsed = parseLatexTable(source)

    expect(parsed.unsafe).to.equal(false)
    expect(parsed.model.rows.map(row => row.longtableSection)).to.deep.equal([
      'firstHead',
      'head',
      'foot',
      'lastFoot',
      'body',
    ])
    const edited = updateCellText(
      parsed.model,
      { row: 4, column: 0 },
      'Changed'
    )
    const generated = generateLatex(edited).latex

    const markers = [
      '\\endfirsthead',
      '\\endhead',
      '\\endfoot',
      '\\endlastfoot',
    ]
    for (let index = 1; index < markers.length; index++) {
      expect(generated.indexOf(markers[index - 1])).to.be.lessThan(
        generated.indexOf(markers[index])
      )
    }
    expect(generated.indexOf('\\caption[Short synthetic]')).to.be.lessThan(
      generated.indexOf('First A')
    )
    expect(generated.indexOf('\\caption*{Last-page note}')).to.be.lessThan(
      generated.indexOf('Last A')
    )
    expect(generated).to.contain('Changed & Body B')
  })

  it('keeps rows inside their longtable section', function () {
    const parsed = parseLatexTable(latex`\begin{longtable}{c}
Header \\
\endhead
Footer \\
\endfoot
Body \\
\end{longtable}`)
    const inserted = insertRow(parsed.model, 1)

    expect(inserted.rows[1].longtableSection).to.equal('foot')
    expect(() =>
      mergeSelection(parsed.model, {
        from: { row: 0, column: 0 },
        to: { row: 1, column: 0 },
      })
    ).to.throw('longtable section boundary')
    expect(getRowMoveError(parsed.model, 0, 0, 3)).to.equal(
      'Rows cannot be moved across a longtable section boundary.'
    )
  })

  it('re-anchors longtable metadata when its following row is deleted', function () {
    const parsed = parseLatexTable(latex`\begin{longtable}{c}
\caption{Anchored synthetic caption} \\

Header one \\

Header two \\

\endfirsthead
Body \\

\end{longtable}`)
    const deleted = deleteRows(parsed.model, 0, 0)
    const generated = generateLatex(deleted).latex

    expect(generated).to.contain('\\caption{Anchored synthetic caption}')
    expect(generated.indexOf('\\caption')).to.be.lessThan(
      generated.indexOf('Header two')
    )
    expect(generated).not.to.contain('Header one')
  })

  it('keeps longtable caption and label below the body', function () {
    const parsed = parseLatexTable(latex`\begin{longtable}{c}
Body value \\

\caption{Bottom synthetic caption}\label{tab:bottom-synthetic} \\

\end{longtable}`)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )
    const generated = generateLatex(edited).latex

    expect(generated.indexOf('Changed')).to.be.lessThan(
      generated.indexOf('\\caption{Bottom synthetic caption}')
    )
    expect(generated.indexOf('\\caption')).to.be.lessThan(
      generated.indexOf('\\label{tab:bottom-synthetic}')
    )
  })
})
