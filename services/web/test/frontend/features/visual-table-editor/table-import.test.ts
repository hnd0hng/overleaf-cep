import { expect } from 'chai'
import { cellAt } from '@/features/visual-table-editor/model'
import {
  createModelFromMatrix,
  detectTableImportFormat,
  MAX_IMPORT_CELLS,
  parseCsvImport,
  parseLatexImport,
} from '@/features/visual-table-editor/table-import'

describe('Visual Table Editor imports', function () {
  describe('format detection', function () {
    it('detects complete supported LaTeX tables', function () {
      expect(
        detectTableImportFormat(String.raw`\begin{tabular}{cc}
A & B \\
\end{tabular}`)
      ).to.equal('latex')
      expect(
        detectTableImportFormat(String.raw`\begin{table}
\begin{longtable}{c}
A \\
\end{longtable}
\end{table}`)
      ).to.equal('latex')
    })

    it('defaults CSV text and incomplete LaTeX to CSV', function () {
      expect(detectTableImportFormat('A,B\nC,D')).to.equal('csv')
      expect(
        detectTableImportFormat(String.raw`\begin{tabular}{cc}
A & B \\`)
      ).to.equal('csv')
    })
  })

  describe('CSV text', function () {
    it('creates a new table with the exact imported dimensions', function () {
      const result = parseCsvImport('Name,Age\nAlice,30')
      expect(result.rows).to.equal(2)
      expect(result.columns).to.equal(2)
      expect(cellAt(result.model, 0, 0)?.content.text).to.equal('Name')
      expect(cellAt(result.model, 1, 1)?.content.text).to.equal('30')
    })

    it('detects semicolon and tab delimiters', function () {
      expect(parseCsvImport('A;B\nC;D').metadata.delimiter).to.equal(';')
      expect(parseCsvImport('A\tB\nC\tD').metadata.delimiter).to.equal('\t')
    })

    it('supports quoted commas, multiline values, and uneven rows', function () {
      const result = parseCsvImport('"A, B",C\n"line 1\nline 2"')
      expect(result.rows).to.equal(2)
      expect(result.columns).to.equal(2)
      expect(cellAt(result.model, 0, 0)?.content.text).to.equal('A, B')
      expect(cellAt(result.model, 1, 0)?.content.text).to.equal(
        'line 1\nline 2'
      )
      expect(cellAt(result.model, 1, 1)?.content.text).to.equal('')
    })

    it('removes only fully empty trailing columns', function () {
      const result = parseCsvImport('field_a,field_b,\nalpha,10,\nbeta,20,')
      expect(result.rows).to.equal(3)
      expect(result.columns).to.equal(2)
      expect(cellAt(result.model, 2, 1)?.content.text).to.equal('20')
    })

    it('preserves empty leading and middle columns', function () {
      const result = parseCsvImport(',field_a,,field_b,\n,left,,right,')
      expect(result.columns).to.equal(4)
      expect(cellAt(result.model, 0, 0)?.content.text).to.equal('')
      expect(cellAt(result.model, 0, 2)?.content.text).to.equal('')
      expect(cellAt(result.model, 1, 3)?.content.text).to.equal('right')
    })

    it('rejects empty and excessively large imports', function () {
      expect(() => parseCsvImport('  ')).to.throw('Enter CSV text')
      expect(() =>
        createModelFromMatrix([Array(MAX_IMPORT_CELLS + 1).fill('')])
      ).to.throw('maximum supported size')
    })
  })

  describe('LaTeX code', function () {
    it('accepts one complete standalone supported environment', function () {
      const result = parseLatexImport(String.raw`\begin{tabular}{lc}
A & B \\
C & D \\
\end{tabular}`)
      expect(result.metadata.environment).to.equal('tabular')
      expect(result.rows).to.equal(2)
      expect(result.columns).to.equal(2)
    })

    it('accepts a complete table wrapper', function () {
      const result = parseLatexImport(String.raw`\begin{table}[htbp]
\centering
\begin{tabularx}{\textwidth}{lX}
A & B \\
\end{tabularx}
\caption{Imported}
\end{table}`)
      expect(result.metadata.environment).to.equal('tabularx')
      expect(result.model.options.caption).to.equal('Imported')
    })

    it('accepts nested table environments inside cells', function () {
      const source = [
        '\\begin{table}[!h]',
        '\\centering',
        '\\caption{Synthetic summary}',
        '\\label{tab:synthetic\\_summary}',
        '\\begin{tabular}{cc}',
        '\\textbf{\\begin{tabular}[c]{@{}c@{}}First\\\\Header\\end{tabular}} &',
        '\\textbf{\\makecell{Second\\\\Header}} \\\\',
        'Item & 7 \\\\',
        '\\end{tabular}',
        '\\end{table}',
      ].join('\n')
      expect(detectTableImportFormat(source)).to.equal('latex')

      const result = parseLatexImport(source)
      expect(result.unsafe).to.equal(false)
      expect(result.rows).to.equal(2)
      expect(result.columns).to.equal(2)
      expect(result.model.options.placement).to.equal('!h')
      expect(result.model.options.label).to.equal('tab:synthetic_summary')
      expect(cellAt(result.model, 0, 0)?.content.text).to.equal('First\nHeader')
      expect(cellAt(result.model, 0, 0)?.content.rawLatex).to.equal(undefined)
    })

    it('warns about unsupported wrapper spacing commands', function () {
      const source = [
        '\\begin{table}[!b]',
        '\\setlength{\\tabcolsep}{3pt}',
        '\\begin{tabular}{c}',
        'Value \\\\',
        '\\end{tabular}',
        '\\label{tab:synthetic\\_spacing}',
        '\\end{table}',
      ].join('\n')
      const warning = parseLatexImport(source)
      expect(warning.unsafe).to.equal(true)
      expect(
        warning.diagnostics.map(item => item.message).join(' ')
      ).to.contain('\\setlength')

      const accepted = parseLatexImport(source, true)
      expect(accepted.model.options.placement).to.equal('!b')
      expect(accepted.model.options.label).to.equal('tab:synthetic_spacing')
    })

    it('repairs single-backslash row separators before horizontal rules after approval', function () {
      const source = String.raw`\begin{tabular}{ccc}
\multirow{2}{*}{Group} & \multicolumn{2}{c}{Heading} \ \cline{2-3}
& Left & Right \ \hline
\end{tabular}`

      const warning = parseLatexImport(source)
      expect(warning.unsafe).to.equal(true)
      expect(warning.diagnostics.map(item => item.message).join(' ')).to.contain(
        'single-backslash row separators'
      )

      const accepted = parseLatexImport(source, true)
      expect(accepted.rows).to.equal(2)
      expect(accepted.columns).to.equal(3)
      expect(cellAt(accepted.model, 0, 0)).to.deep.include({ rowSpan: 2 })
      expect(cellAt(accepted.model, 0, 1)).to.deep.include({ columnSpan: 2 })
      expect(cellAt(accepted.model, 1, 1)?.content.text).to.equal('Left')
      expect(cellAt(accepted.model, 1, 2)?.content.text).to.equal('Right')
    })

    it('does not reinterpret a single-backslash space inside cell content', function () {
      const result = parseLatexImport(String.raw`\begin{tabular}{c}
Value\ (masked) \\
\end{tabular}`)

      expect(result.unsafe).to.equal(false)
      expect(cellAt(result.model, 0, 0)?.content.text).to.equal(
        String.raw`Value\ (masked)`
      )
    })

    it('rejects fragments, missing endings, and multiple tables', function () {
      expect(() => parseLatexImport(String.raw`A & B \\`)).to.throw(
        'exactly one supported'
      )
      expect(() =>
        parseLatexImport(String.raw`\begin{tabular}{c} A \\`)
      ).to.throw('Missing \\end{tabular}')
      expect(() =>
        parseLatexImport(String.raw`\begin{tabular}{c}A \\
\end{tabular}
\begin{tabular}{c}B \\
\end{tabular}`)
      ).to.throw('exactly one supported')
    })

    it('requires approval before materializing an unsafe import', function () {
      const source = String.raw`\begin{tabular}{cc}
A & B \\ \cmidrule{1-2}
C & D \\
\end{tabular}`
      const warning = parseLatexImport(source)
      expect(warning.unsafe).to.equal(true)
      expect(warning.diagnostics).to.have.length.greaterThan(0)

      const accepted = parseLatexImport(source, true)
      expect(accepted.unsafe).to.equal(true)
      expect(accepted.model.unsafeImport).to.equal(true)
      expect(cellAt(accepted.model, 0, 0)?.content.text).to.equal('A')
    })
  })
})
