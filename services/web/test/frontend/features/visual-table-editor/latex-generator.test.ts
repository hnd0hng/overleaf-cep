import {
  generateLatex,
  parseLatexTable,
} from '@/features/visual-table-editor/latex'
import { updateCellText } from '@/features/visual-table-editor/model'
import { expect } from 'chai'

const latex = String.raw

describe('Visual Table Editor analyzed LaTeX generation', function () {
  it('generates a partial rule at the bottom boundary', function () {
    const parsed = parseLatexTable(latex`\begin{tabular}{cc}
Alpha & Beta \\ \cline{1-1}
\end{tabular}`)
    const edited = updateCellText(
      parsed.model,
      { row: 0, column: 0 },
      'Changed'
    )

    expect(generateLatex(edited).latex).to.contain('\\cline{1-1}')
  })

  it('ignores table-looking text inside a LaTeX comment', function () {
    const source = latex`% \begin{tabular}{c}Ignored\end{tabular}
\begin{tabular}{c}
Visible \\
\end{tabular}`
    const parsed = parseLatexTable(source)

    expect(parsed.model.rows).to.have.length(1)
    const generated = generateLatex(parsed.model).latex
    expect(generated).to.contain('Visible')
    expect(generated).not.to.contain('Ignored')
    expect(parseLatexTable(generated).model.rows).to.have.length(1)
  })

  it('collects packages from semantic raw cell content', function () {
    const source = latex`\begin{tabular}{c}
\makecell{One \\ Two} \\
\end{tabular}`
    const generated = generateLatex(parseLatexTable(source).model)

    expect(generated.latex).to.match(/\\makecell/)
    expect(generated.packages).to.include('makecell')
  })
})
