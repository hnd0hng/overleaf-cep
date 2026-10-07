import { getCells, cellAt } from '../../model'
import type {
  BorderStyle,
  Diagnostic,
  HorizontalAlignment,
  TableCell,
  TableColumn,
  TableDirective,
  TableModel,
} from '../../types'
import { environmentNeedsWidth } from '../environment'
import { LONGTABLE_SECTION_ORDER } from '../longtable-sections'
import { analyzeBoundaryRules } from './boundary-analyzer'
import { collectSourcePackages } from './package-analyzer'

const alignmentLetter = (alignment: HorizontalAlignment) =>
  alignment === 'left' ? 'l' : alignment === 'right' ? 'r' : 'c'

const boundaryLatex = (style: BorderStyle | undefined) =>
  style === 'double' ? '||' : style === 'solid' ? '|' : ''

const generateColumn = (column: TableColumn) => {
  const alignment = alignmentLetter(column.alignment)
  const modifiers: string[] = []
  if (column.backgroundColor) {
    modifiers.push(`\\columncolor{${column.backgroundColor}}`)
  }
  if (column.width.mode === 'flex') {
    const prefix = modifiers.length ? `>{${modifiers.join('')}}` : ''
    return `${prefix}X`
  }
  if (column.width.mode === 'fixed') {
    const vertical =
      column.verticalAlignment === 'middle'
        ? 'm'
        : column.verticalAlignment === 'bottom'
          ? 'b'
          : 'p'
    if (column.alignmentExplicit !== false) {
      const alignCommand =
        alignment === 'l'
          ? '\\raggedright'
          : alignment === 'r'
            ? '\\raggedleft'
            : '\\centering'
      modifiers.push(`${alignCommand}\\arraybackslash`)
    }
    const prefix = modifiers.length ? `>{${modifiers.join('')}}` : ''
    return `${prefix}${vertical}{${column.width.value}${column.width.unit}}`
  }
  const prefix = modifiers.length ? `>{${modifiers.join('')}}` : ''
  return `${prefix}${alignment}`
}
const renderMultiline = (
  text: string,
  fixedWidth: boolean,
  alignment: string,
  presentation: TableCell['latexPresentation'],
  packages: Set<string>,
  escapeLatex: (value: string) => string
) => {
  const lines = text.split(/\r?\n/).map(escapeLatex)
  if (lines.length === 1) return lines[0]
  if (presentation?.multiline === 'makecell') {
    packages.add('makecell')
    const option = presentation.alignment
      ? `[${alignmentLetter(presentation.alignment)}]`
      : ''
    return `\\makecell${option}{${lines.join(' \\\\ ')}}`
  }
  if (presentation?.multiline === 'nested-tabular') {
    return `\\begin{tabular}[c]{@{}${alignment}@{}}${lines.join(' \\\\ ')}\\end{tabular}`
  }
  if (fixedWidth) return lines.join('\\newline ')
  return `\\shortstack[${alignment}]{${lines.join(' \\\\ ')}}`
}

const renderCellContent = (
  model: TableModel,
  cell: TableCell,
  column: TableColumn,
  packages: Set<string>,
  escapeLatex: (value: string) => string
) => {
  const alignment = alignmentLetter(
    cell.horizontalAlignment ?? column.alignment
  )
  let value =
    cell.content.rawLatex ??
    renderMultiline(
      cell.content.text,
      column.width.mode === 'fixed',
      alignment,
      cell.latexPresentation,
      packages,
      escapeLatex
    )
  if (cell.content.style?.bold) value = `\\textbf{${value}}`
  if (cell.content.style?.italic) value = `\\textit{${value}}`
  if (cell.content.style?.color) {
    if (!packages.has('xcolor[table]')) packages.add('xcolor')
    value = `\\textcolor{${cell.content.style.color}}{${value}}`
  }
  if (cell.backgroundColor) {
    packages.delete('xcolor')
    packages.add('xcolor[table]')
    value = `\\cellcolor{${cell.backgroundColor}}${value}`
  }
  if (cell.rowSpan > 1) {
    packages.add('multirow')
    value = `\\multirow{${cell.rowSpan}}{*}{${value}}`
  }

  const globalLeft = model.columnBoundaries?.[cell.column] ?? 'none'
  const globalRight =
    model.columnBoundaries?.[cell.column + cell.columnSpan] ?? 'none'
  const localLeft = cell.borders.left
  const localRight = cell.borders.right
  const verticalOverride =
    cell.columnSpan === 1 &&
    (boundaryLatex(localLeft) !== boundaryLatex(globalLeft) ||
      boundaryLatex(localRight) !== boundaryLatex(globalRight))
  const alignmentOverride =
    cell.horizontalAlignment !== undefined &&
    cell.horizontalAlignment !== column.alignment &&
    !cell.content.text.includes('\n')

  if (cell.columnSpan > 1 || verticalOverride || alignmentOverride) {
    const left =
      cell.columnSpan > 1 || verticalOverride ? localLeft : globalLeft
    const right =
      cell.columnSpan > 1 || verticalOverride ? localRight : globalRight
    const specification = `${boundaryLatex(left)}${alignment}${boundaryLatex(right)}`
    value = `\\multicolumn{${cell.columnSpan}}{${specification}}{${value}}`
  }
  return value
}

export type GenerationResult = {
  latex: string
  packages: string[]
  warnings: Diagnostic[]
}

const canonicalDirectives = (model: TableModel) => {
  const directives = [...(model.options.directives ?? [])]
  const has = (kind: TableDirective['kind']) =>
    directives.some(directive => directive.kind === kind)
  if (model.options.centered && !has('centering')) {
    directives.push({
      kind: 'centering',
      position: 'before-grid',
      order: -100,
    })
  }
  if (model.options.caption && !has('caption')) {
    directives.push({ kind: 'caption', position: 'after-grid', order: 100 })
  }
  if (model.options.label && !has('label')) {
    directives.push({ kind: 'label', position: 'after-grid', order: 101 })
  }
  return directives
}

const renderDirective = (
  directive: TableDirective,
  model: TableModel,
  escapeLatex: (value: string) => string
) => {
  switch (directive.kind) {
    case 'centering':
      return model.options.centered ? '\\centering' : ''
    case 'caption':
      return model.options.caption
        ? `\\caption{${
            model.options.captionIsLatex
              ? model.options.caption
              : escapeLatex(model.options.caption)
          }}`
        : ''
    case 'label':
      return model.options.label
        ? `\\label{${escapeLatex(model.options.label)}}`
        : ''
    case 'tabcolsep':
      return directive.value
        ? `\\setlength{\\tabcolsep}{${directive.value}}`
        : ''
    case 'arraystretch':
      return directive.value
        ? `\\renewcommand{\\arraystretch}{${directive.value}}`
        : ''
    case 'font-size':
      return directive.value ? `\\${directive.value}` : ''
    case 'rowcolors':
      return directive.arguments?.length === 3
        ? `\\rowcolors{${directive.arguments.join('}{')}}`
        : ''
  }
}

const renderDirectives = (
  directives: TableDirective[],
  position: TableDirective['position'],
  model: TableModel,
  escapeLatex: (value: string) => string,
  scoped?: boolean
) =>
  directives
    .filter(
      directive =>
        directive.position === position &&
        (scoped === undefined || Boolean(directive.scoped) === scoped)
    )
    .sort((left, right) => left.order - right.order)
    .map(directive => renderDirective(directive, model, escapeLatex))
    .filter(Boolean)

export const generateCanonicalLatex = (
  model: TableModel,
  escapeLatex: (value: string) => string
): GenerationResult => {
  const packages = new Set<string>()
  const warnings: Diagnostic[] = []
  collectSourcePackages(
    getCells(model)
      .map(cell => cell.content.rawLatex ?? '')
      .join('\n'),
    packages
  )
  const boundaries = Array.from(
    { length: model.columns.length + 1 },
    (_, index) => model.columnBoundaries?.[index] ?? 'none'
  )
  const columnSpec =
    model.columns
      .map(
        (column, index) =>
          `${boundaryLatex(boundaries[index])}${generateColumn(column)}`
      )
      .join('') + boundaryLatex(boundaries.at(-1))

  if (model.columns.some(column => column.width.mode === 'fixed')) {
    packages.add('array')
  }
  if (
    model.columns.some(column => column.backgroundColor) ||
    model.options.directives?.some(directive => directive.kind === 'rowcolors')
  ) {
    packages.delete('xcolor')
    packages.add('xcolor[table]')
  }
  if (model.options.style === 'booktabs') packages.add('booktabs')
  if (model.options.environment === 'tabularx') packages.add('tabularx')
  if (model.options.environment === 'xltabular') packages.add('xltabular')
  if (model.options.environment === 'longtable') packages.add('longtable')
  const wrapperEnvironment =
    model.options.wrapper ??
    (model.options.environment === 'longtable' ? 'standalone' : 'table')
  if (wrapperEnvironment.startsWith('sidewaystable')) {
    packages.add('rotating')
  }

  const renderBoundaryRule = analyzeBoundaryRules(model)
  const rowContentLines: string[] = []
  const rowLines: string[] = []
  for (let row = 0; row < model.rows.length; row++) {
    const parts: string[] = []
    const boundaryRule = renderBoundaryRule(row)
    if (model.rows[row].backgroundColor) {
      packages.delete('xcolor')
      packages.add('xcolor[table]')
      parts.push(`\\rowcolor{${model.rows[row].backgroundColor}}`)
    }
    const values: string[] = []
    for (let column = 0; column < model.columns.length; ) {
      const cell = cellAt(model, row, column)!
      if (cell.row < row) {
        values.push('')
        column++
      } else {
        values.push(
          renderCellContent(
            model,
            cell,
            model.columns[column],
            packages,
            escapeLatex
          )
        )
        column += cell.columnSpan
      }
    }
    parts.push(`  ${values.join(' & ')} \\\\`)
    const content = parts.join('\n')
    rowContentLines.push(content)
    rowLines.push([boundaryRule, content].filter(Boolean).join('\n'))
  }
  const trailingRule = renderBoundaryRule(model.rows.length)

  const environment = model.options.environment
  const position = model.options.environmentPosition
    ? `[${model.options.environmentPosition}]`
    : ''
  const begin = environmentNeedsWidth(environment)
    ? `\\begin{${environment}}{${model.options.targetWidth}}${environment === 'tabular*' ? position : ''}{${columnSpec}}`
    : `\\begin{${environment}}${position}{${columnSpec}}`
  const directives = canonicalDirectives(model)
  const before = renderDirectives(
    directives,
    'before-grid',
    model,
    escapeLatex,
    false
  )
  const scopedBefore = renderDirectives(
    directives,
    'before-grid',
    model,
    escapeLatex,
    true
  )
  const after = renderDirectives(directives, 'after-grid', model, escapeLatex)

  if (environment === 'longtable') {
    const terminateMetadataRow = (lines: string[]) => {
      const result: string[] = []
      let metadata = ''
      const flush = () => {
        if (!metadata) return
        result.push(metadata + '\\\\')
        metadata = ''
      }
      for (const line of lines) {
        if (line.startsWith('\\caption') || line.startsWith('\\label')) {
          metadata += line
        } else {
          flush()
          result.push(line)
        }
      }
      flush()
      return result
    }
    const longtableBefore = terminateMetadataRow([...before, ...scopedBefore])
    const longtableAfter = terminateMetadataRow(after)
    const body = [begin, ...longtableBefore]
    const hasSections = model.rows.some(row => row.longtableSection)
    if (hasSections) {
      const markers: Partial<
        Record<(typeof LONGTABLE_SECTION_ORDER)[number], string>
      > = {
        firstHead: '\\endfirsthead',
        head: '\\endhead',
        foot: '\\endfoot',
        lastFoot: '\\endlastfoot',
      }
      for (const section of LONGTABLE_SECTION_ORDER) {
        const sectionRules = model.options.longtableSectionRules?.[section]
        if (sectionRules) body.push(...sectionRules.prefix)
        const indexes = model.rows
          .map((row, index) => ({ row, index }))
          .filter(item => (item.row.longtableSection ?? 'body') === section)
          .map(item => item.index)
        indexes.forEach((index, position) => {
          if (position > 0) {
            const rule = renderBoundaryRule(index)
            if (rule) body.push(rule)
          }
          body.push(sectionRules ? rowContentLines[index] : rowLines[index])
        })
        if (sectionRules) body.push(...sectionRules.suffix)
        const marker = markers[section]
        if (marker && model.options.longtableMarkers?.includes(marker)) {
          body.push(marker)
        }
      }
    } else {
      const repeatCount =
        model.rows.findLastIndex(row => row.repeatOnNewPage) + 1
      if (repeatCount > 0) {
        const header = rowLines.slice(0, repeatCount)
        body.push(
          ...header,
          '\\endfirsthead',
          ...header,
          '\\endhead',
          ...rowLines.slice(repeatCount)
        )
      } else {
        body.push(...rowLines)
      }
    }
    if (trailingRule && !model.options.longtableSectionRules) {
      body.push(trailingRule)
    }
    body.push(...longtableAfter, `\\end{${environment}}`)
    if (model.options.scale !== 'none') {
      warnings.push({
        severity: 'warning',
        message:
          'Longtable cannot be safely wrapped in resizebox; scaling was ignored.',
      })
    }
    return { latex: body.join('\n'), packages: [...packages], warnings }
  }

  let inner = `${begin}\n${[...rowLines, ...(trailingRule ? [trailingRule] : [])].join('\n')}\n\\end{${environment}}`
  if (scopedBefore.length) {
    inner = `{\n${scopedBefore.join('\n')}\n${inner}\n}`
  }
  if (model.options.scale !== 'none') {
    packages.add('graphicx')
    const width =
      model.options.scale === 'textwidth' ? '\\textwidth' : '\\columnwidth'
    inner = `\\resizebox{${width}}{!}{%\n${inner}\n}`
  }

  if (wrapperEnvironment === 'standalone') {
    return {
      latex: [...before, inner, ...after].join('\n'),
      packages: [...packages],
      warnings,
    }
  }

  const wrapper = [
    `\\begin{${wrapperEnvironment}}${model.options.placement ? `[${model.options.placement}]` : ''}`,
    ...before.map(line => `  ${line}`),
    ...inner.split('\n').map(line => `  ${line}`),
    ...after.map(line => `  ${line}`),
    `\\end{${wrapperEnvironment}}`,
  ]
  return { latex: wrapper.join('\n'), packages: [...packages], warnings }
}
