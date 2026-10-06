import { generateLatex } from '@/features/visual-table-editor/latex'
import { cellAt, getCells } from '@/features/visual-table-editor/model'
import { parseLatexImport } from '@/features/visual-table-editor/table-import'
import { TableModel } from '@/features/visual-table-editor/types'
import { expect } from 'chai'

type ExpectedCell = {
  row: number
  column: number
  text?: string
  rawLatex?: string
  rowSpan?: number
  columnSpan?: number
  bold?: boolean
  italic?: boolean
}

type RoundTripCase = {
  name: string
  source: string
  rows: number
  columns: number
  cells?: ExpectedCell[]
  environment?: 'tabular' | 'tabularx' | 'longtable'
  verify?: (model: TableModel) => void
}

const latex = String.raw

export const LATEX_ROUND_TRIP_CASES: RoundTripCase[] = [
  {
    name: 'plain 2 by 2 table',
    source: latex`\begin{tabular}{cc}
Alpha & Beta \\
Gamma & Delta \\
\end{tabular}`,
    rows: 2,
    columns: 2,
    cells: [
      { row: 0, column: 0, text: 'Alpha' },
      { row: 1, column: 1, text: 'Delta' },
    ],
  },
  {
    name: 'left center and right column alignment',
    source: latex`\begin{tabular}{lcr}
Left & Center & Right \\
\end{tabular}`,
    rows: 1,
    columns: 3,
    verify: model => {
      expect(model.columns.map(column => column.alignment)).to.deep.equal([
        'left',
        'center',
        'right',
      ])
    },
  },
  {
    name: 'empty leading middle and trailing cells',
    source: latex`\begin{tabular}{cccc}
 & Middle & & \\
\end{tabular}`,
    rows: 1,
    columns: 4,
    cells: [
      { row: 0, column: 0, text: '' },
      { row: 0, column: 1, text: 'Middle' },
      { row: 0, column: 3, text: '' },
    ],
  },
  {
    name: 'escaped literal characters',
    source: latex`\begin{tabular}{cc}
A\&B & C\_D \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    cells: [
      { row: 0, column: 0, text: 'A&B' },
      { row: 0, column: 1, text: 'C_D' },
    ],
  },
  {
    name: 'bold cells',
    source: latex`\begin{tabular}{cc}
\textbf{Bold} & Plain \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    cells: [{ row: 0, column: 0, text: 'Bold', bold: true }],
  },
  {
    name: 'italic cells',
    source: latex`\begin{tabular}{cc}
\textit{Italic} & Plain \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    cells: [{ row: 0, column: 0, text: 'Italic', italic: true }],
  },
  {
    name: 'nested bold and italic styles',
    source: latex`\begin{tabular}{c}
\textbf{\textit{Both}} \\
\end{tabular}`,
    rows: 1,
    columns: 1,
    cells: [{ row: 0, column: 0, text: 'Both', bold: true, italic: true }],
  },
  {
    name: 'opaque inline mathematics',
    source: latex`\begin{tabular}{cc}
$x_1 + y_2$ & 42 \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    cells: [{ row: 0, column: 0, rawLatex: '$x_1 + y_2$' }],
  },
  {
    name: 'text color command',
    source: latex`\begin{tabular}{c}
\textcolor{blue}{Synthetic} \\
\end{tabular}`,
    rows: 1,
    columns: 1,
    cells: [{ row: 0, column: 0, text: 'Synthetic' }],
    verify: model =>
      expect(cellAt(model, 0, 0)?.content.style?.color).to.equal('blue'),
  },
  {
    name: 'vertical and horizontal borders',
    source: latex`\begin{tabular}{|c|c|}
\hline
A & B \\ \hline
C & D \\ \hline
\end{tabular}`,
    rows: 2,
    columns: 2,
    verify: model => {
      expect(cellAt(model, 0, 0)?.borders).to.deep.equal({
        top: 'solid',
        right: 'solid',
        bottom: 'none',
        left: 'solid',
      })
      expect(cellAt(model, 1, 1)?.borders.bottom).to.equal('solid')
    },
  },
  {
    name: 'partial horizontal clines',
    source: latex`\begin{tabular}{ccc}
A & B & C \\ \cline{2-3}
D & E & F \\
\end{tabular}`,
    rows: 2,
    columns: 3,
    verify: model => {
      expect(cellAt(model, 1, 0)?.borders.top).to.equal('none')
      expect(cellAt(model, 1, 1)?.borders.top).to.equal('solid')
      expect(cellAt(model, 1, 2)?.borders.top).to.equal('solid')
    },
  },
  {
    name: 'booktabs rules',
    source: latex`\begin{tabular}{cc}
\toprule
Name & Value \\ \midrule
Item & 7 \\ \bottomrule
\end{tabular}`,
    rows: 2,
    columns: 2,
    verify: model => expect(model.options.style).to.equal('booktabs'),
  },
  {
    name: 'table wrapper metadata',
    source: latex`\begin{table}[!ht]
\centering
\begin{tabular}{cc}
A & B \\
\end{tabular}
\caption{Synthetic Caption}
\label{tab:synthetic_case}
\end{table}`,
    rows: 1,
    columns: 2,
    verify: model => {
      expect(model.options).to.deep.include({
        centered: true,
        placement: '!ht',
        caption: 'Synthetic Caption',
        label: 'tab:synthetic_case',
      })
    },
  },
  {
    name: 'tabularx flex columns',
    source: latex`\begin{tabularx}{\linewidth}{lXr}
Left & Flexible content & Right \\
\end{tabularx}`,
    rows: 1,
    columns: 3,
    environment: 'tabularx',
    verify: model => {
      expect(model.options.targetWidth).to.equal(String.raw`\linewidth`)
      expect(model.columns[1].width.mode).to.equal('flex')
    },
  },
  {
    name: 'fixed width paragraph column',
    source: latex`\begin{tabular}{p{3cm}c}
Paragraph & Value \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    verify: model =>
      expect(model.columns[0].width).to.deep.equal({
        mode: 'fixed',
        value: 3,
        unit: 'cm',
      }),
  },
  {
    name: 'fixed width middle and bottom columns',
    source: latex`\begin{tabular}{m{2.5cm}b{18mm}}
Middle & Bottom \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    verify: model => {
      expect(model.columns[0].verticalAlignment).to.equal('middle')
      expect(model.columns[1].verticalAlignment).to.equal('bottom')
    },
  },
  {
    name: 'resize to text width',
    source: latex`\begin{table}
\resizebox{\textwidth}{!}{%
\begin{tabular}{cc}
A & B \\
\end{tabular}
}
\end{table}`,
    rows: 1,
    columns: 2,
    verify: model => expect(model.options.scale).to.equal('textwidth'),
  },
  {
    name: 'single horizontal merge',
    source: latex`\begin{tabular}{ccc}
\multicolumn{2}{c}{Merged} & Tail \\
\end{tabular}`,
    rows: 1,
    columns: 3,
    cells: [
      { row: 0, column: 0, text: 'Merged', columnSpan: 2 },
      { row: 0, column: 2, text: 'Tail' },
    ],
  },
  {
    name: 'two horizontal merges in different rows',
    source: latex`\begin{tabular}{cccc}
\multicolumn{3}{c}{Wide} & X \\
Y & \multicolumn{2}{c}{Middle} & Z \\
\end{tabular}`,
    rows: 2,
    columns: 4,
    cells: [
      { row: 0, column: 0, text: 'Wide', columnSpan: 3 },
      { row: 1, column: 1, text: 'Middle', columnSpan: 2 },
    ],
  },
  {
    name: 'single vertical merge',
    source: latex`\begin{tabular}{cc}
\multirow{2}{*}{Tall} & A \\
 & B \\
\end{tabular}`,
    rows: 2,
    columns: 2,
    cells: [{ row: 0, column: 0, text: 'Tall', rowSpan: 2 }],
  },
  {
    name: 'three row vertical merge',
    source: latex`\begin{tabular}{ccc}
X & \multirow{3}{*}{Tall} & A \\
Y & & B \\
Z & & C \\
\end{tabular}`,
    rows: 3,
    columns: 3,
    cells: [{ row: 0, column: 1, text: 'Tall', rowSpan: 3 }],
  },
  {
    name: 'combined two by two merge',
    source: latex`\begin{tabular}{ccc}
\multicolumn{2}{c}{\multirow{2}{*}{Block}} & A \\
 & & B \\
\end{tabular}`,
    rows: 2,
    columns: 3,
    cells: [
      {
        row: 0,
        column: 0,
        text: 'Block',
        rowSpan: 2,
        columnSpan: 2,
      },
    ],
  },
  {
    name: 'combined two by three merge with neighboring cells',
    source: latex`\begin{tabular}{cccc}
L & \multicolumn{2}{c}{\multirow{3}{*}{Block}} & R1 \\
L2 & & & R2 \\
L3 & & & R3 \\
\end{tabular}`,
    rows: 3,
    columns: 4,
    cells: [
      {
        row: 0,
        column: 1,
        text: 'Block',
        rowSpan: 3,
        columnSpan: 2,
      },
      { row: 2, column: 3, text: 'R3' },
    ],
  },
  {
    name: 'multiple independent row and column merges',
    source: latex`\begin{tabular}{cccc}
\multirow{2}{*}{Left} & \multicolumn{2}{c}{Top} & R1 \\
 & B & C & R2 \\
\multicolumn{2}{c}{Bottom} & D & E \\
\end{tabular}`,
    rows: 3,
    columns: 4,
    cells: [
      { row: 0, column: 0, text: 'Left', rowSpan: 2 },
      { row: 0, column: 1, text: 'Top', columnSpan: 2 },
      { row: 2, column: 0, text: 'Bottom', columnSpan: 2 },
    ],
  },
  {
    name: 'bordered combined merge',
    source: latex`\begin{tabular}{|c|c|c|}
\hline
\multicolumn{2}{|c|}{\multirow{2}{*}{Block}} & A \\ \cline{3-3}
 & & B \\ \hline
\end{tabular}`,
    rows: 2,
    columns: 3,
    cells: [
      {
        row: 0,
        column: 0,
        text: 'Block',
        rowSpan: 2,
        columnSpan: 2,
      },
    ],
  },
  {
    name: 'single-column nested tabular imported as multiline text',
    source: latex`\begin{tabular}{cc}
\begin{tabular}{c}Line 1\\Line 2\end{tabular} & Value \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    cells: [
      {
        row: 0,
        column: 0,
        text: 'Line 1\nLine 2',
      },
    ],
  },
  {
    name: 'simple longtable',
    source: latex`\begin{longtable}{lc}
Name & Value \\
Item & 9 \\
\end{longtable}`,
    rows: 2,
    columns: 2,
    environment: 'longtable',
  },
  {
    name: 'all escaped literal characters remain editable',
    source: latex`\begin{tabular}{c}
\%\$\#\_\{\} \\
\end{tabular}`,
    rows: 1,
    columns: 1,
    cells: [{ row: 0, column: 0, text: '%$#_{}' }],
  },
  {
    name: 'shortstack multiline cell generated by the editor',
    source: latex`\begin{tabular}{c}
\shortstack[c]{Line A \\ Line B} \\
\end{tabular}`,
    rows: 1,
    columns: 1,
    cells: [{ row: 0, column: 0, text: 'Line A\nLine B' }],
  },
  {
    name: 'fixed width multiline cell generated by the editor',
    source: latex`\begin{tabular}{p{4cm}}
Line A\newline Line B \\
\end{tabular}`,
    rows: 1,
    columns: 1,
    cells: [{ row: 0, column: 0, text: 'Line A\nLine B' }],
  },
  {
    name: 'text and background colors generated by the editor',
    source: latex`\begin{tabular}{c}
\cellcolor{yellow}\textcolor{blue}{Tone} \\
\end{tabular}`,
    rows: 1,
    columns: 1,
    cells: [{ row: 0, column: 0, text: 'Tone' }],
    verify: model => {
      expect(cellAt(model, 0, 0)?.content.style?.color).to.equal('blue')
      expect(cellAt(model, 0, 0)?.backgroundColor).to.equal('yellow')
    },
  },
  {
    name: 'single cell alignment override',
    source: latex`\begin{tabular}{cc}
\multicolumn{1}{r}{Right} & Center \\
\end{tabular}`,
    rows: 1,
    columns: 2,
    cells: [{ row: 0, column: 0, text: 'Right' }],
    verify: model =>
      expect(cellAt(model, 0, 0)?.horizontalAlignment).to.equal('right'),
  },
  {
    name: 'escaped caption remains literal after generation',
    source: latex`\begin{table}
\begin{tabular}{c}
Value \\
\end{tabular}
\caption{A \& B}
\end{table}`,
    rows: 1,
    columns: 1,
    verify: model => expect(model.options.caption).to.equal('A & B'),
  },
  {
    name: 'longtable caption and label are not data rows',
    source: latex`\begin{longtable}{cc}
\caption{Synthetic Long Table}\label{tab:long_synthetic} \\
Name & Value \\
\end{longtable}`,
    rows: 1,
    columns: 2,
    environment: 'longtable',
    cells: [{ row: 0, column: 0, text: 'Name' }],
    verify: model => {
      expect(model.options.caption).to.equal('Synthetic Long Table')
      expect(model.options.label).to.equal('tab:long_synthetic')
    },
  },
  {
    name: 'generated longtable repeating header',
    source: latex`\begin{longtable}{cc}
Header A & Header B \\
\endfirsthead
Header A & Header B \\
\endhead
Data A & Data B \\
\end{longtable}`,
    rows: 3,
    columns: 2,
    environment: 'longtable',
    cells: [
      { row: 0, column: 0, text: 'Header A' },
      { row: 1, column: 0, text: 'Header A' },
      { row: 2, column: 0, text: 'Data A' },
    ],
    verify: model => expect(model.rows[0].repeatOnNewPage).to.equal(true),
  },
]

const modelSnapshot = (model: TableModel) => ({
  rows: model.rows.map(row => ({ repeatOnNewPage: row.repeatOnNewPage })),
  columns: model.columns.map(({ alignment, verticalAlignment, width }) => ({
    alignment,
    verticalAlignment,
    width,
  })),
  cells: getCells(model)
    .map(
      ({
        row,
        column,
        rowSpan,
        columnSpan,
        content,
        horizontalAlignment,
        verticalAlignment,
        backgroundColor,
        borders,
        numberFormat,
      }) => ({
        row,
        column,
        rowSpan,
        columnSpan,
        content,
        horizontalAlignment,
        verticalAlignment,
        backgroundColor,
        borders,
        numberFormat,
      })
    )
    .sort((a, b) => a.row - b.row || a.column - b.column),
  options: model.options,
})

describe('Visual Table Editor LaTeX import and generation round trips', function () {
  for (const testCase of LATEX_ROUND_TRIP_CASES) {
    it(testCase.name, function () {
      const imported = parseLatexImport(testCase.source)

      expect(imported.unsafe).to.equal(false)
      expect(imported.model.rows).to.have.length(testCase.rows)
      expect(imported.model.columns).to.have.length(testCase.columns)
      expect(imported.model.options.environment).to.equal(
        testCase.environment ?? 'tabular'
      )
      for (const expected of testCase.cells ?? []) {
        const cell = cellAt(imported.model, expected.row, expected.column)
        expect(cell, `cell ${expected.row}:${expected.column}`).to.exist
        if (expected.text !== undefined)
          expect(cell?.content.text).to.equal(expected.text)
        if (expected.rawLatex !== undefined)
          expect(cell?.content.rawLatex).to.equal(expected.rawLatex)
        if (expected.rowSpan !== undefined)
          expect(cell?.rowSpan).to.equal(expected.rowSpan)
        if (expected.columnSpan !== undefined)
          expect(cell?.columnSpan).to.equal(expected.columnSpan)
        if (expected.bold !== undefined)
          expect(cell?.content.style?.bold).to.equal(expected.bold)
        if (expected.italic !== undefined)
          expect(cell?.content.style?.italic).to.equal(expected.italic)
      }
      testCase.verify?.(imported.model)

      const preview = generateLatex(imported.model).latex
      const reparsed = parseLatexImport(preview)
      expect(modelSnapshot(reparsed.model)).to.deep.equal(
        modelSnapshot(imported.model)
      )
    })
  }
})
