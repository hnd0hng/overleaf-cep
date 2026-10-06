import { generateSHA1Hash } from '@/shared/utils/sha1'
import {
  createTableModel,
  Diagnostic,
  emptyBorders,
  HorizontalAlignment,
  TableCell,
  TableColumn,
  TableEnvironment,
  TableModel,
  LatexLongtableSectionLayout,
} from './types'
import { assertModel, cellAt, getCells } from './model'
import { parseColumnSpecification } from './latex/column-spec'
import { environmentNeedsWidth, isTableEnvironment } from './latex/environment'
import { analyzeBoundaryRules } from './latex/generator/boundary-analyzer'
import { collectSourcePackages } from './latex/generator/package-analyzer'
import { renderImportedTable } from './latex/generator/source-layout-renderer'
import { buildLatexGrid } from './latex/grid-builder'
import { parseLatexFragment, parseLatexSyntax } from './latex/parser'
import type { LatexNode } from './latex/syntax-tree'
import { readTablePreamble, parseTableBody } from './latex/import-structure'
import {
  collectMetadataSpans,
  detectWrapper,
  templateSourceRange,
} from './latex/source-layout'
import {
  attachLatexOrigin,
  unchangedLatexSource,
} from './latex/source-preservation'

const SPECIAL_CHARACTERS: Record<string, string> = {
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\\': '\\textbackslash{}',
}

export const escapeLatex = (value: string) =>
  [...value]
    .map(character => SPECIAL_CHARACTERS[character] ?? character)
    .join('')

const alignmentLetter = (alignment: HorizontalAlignment) =>
  alignment === 'left' ? 'l' : alignment === 'right' ? 'r' : 'c'

const generateColumn = (column: TableColumn) => {
  const alignment = alignmentLetter(column.alignment)
  if (column.width.mode === 'flex') return 'X'
  if (column.width.mode === 'fixed') {
    const vertical =
      column.verticalAlignment === 'middle'
        ? 'm'
        : column.verticalAlignment === 'bottom'
          ? 'b'
          : 'p'
    const alignCommand =
      alignment === 'l'
        ? '\\raggedright'
        : alignment === 'r'
          ? '\\raggedleft'
          : '\\centering'
    return `>{${alignCommand}\\arraybackslash}${vertical}{${column.width.value}${column.width.unit}}`
  }
  return alignment
}

const renderMultiline = (
  text: string,
  fixedWidth: boolean,
  alignment: string
) => {
  const lines = text.split(/\r?\n/).map(escapeLatex)
  if (lines.length === 1) return lines[0]
  if (fixedWidth) return lines.join('\\newline ')
  return `\\shortstack[${alignment}]{${lines.join(' \\\\ ')}}`
}

const renderCellContent = (
  cell: TableCell,
  column: TableColumn,
  packages: Set<string>,
  includeVerticalBorders: boolean
) => {
  const alignment = alignmentLetter(
    cell.horizontalAlignment ?? column.alignment
  )
  let value =
    cell.content.rawLatex ??
    renderMultiline(cell.content.text, column.width.mode === 'fixed', alignment)
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
  const hasLeftBorder = includeVerticalBorders && cell.borders.left !== 'none'
  const hasRightBorder = includeVerticalBorders && cell.borders.right !== 'none'
  const verticalSpecification = `${hasLeftBorder ? '|' : ''}${alignment}${hasRightBorder ? '|' : ''}`
  if (
    cell.columnSpan > 1 ||
    cell.horizontalAlignment ||
    hasLeftBorder ||
    hasRightBorder
  ) {
    value = `\\multicolumn{${cell.columnSpan}}{${verticalSpecification}}{${value}}`
  }
  return value
}

export type GenerationResult = {
  latex: string
  packages: string[]
  warnings: Diagnostic[]
}

export const generateLatex = (model: TableModel): GenerationResult => {
  assertModel(model)
  const preservedSource = unchangedLatexSource(model)
  const packages = new Set<string>()
  collectSourcePackages(preservedSource, packages)
  const warnings: Diagnostic[] = []
  const renderBoundaryRule = analyzeBoundaryRules(model)
  const columnSpec = model.columns.map(generateColumn).join('')
  if (model.columns.some(column => column.width.mode === 'fixed')) {
    packages.add('array')
  }
  if (model.options.style === 'booktabs') packages.add('booktabs')
  if (model.options.environment === 'tabularx') packages.add('tabularx')
  if (model.options.environment === 'xltabular') packages.add('xltabular')
  if (model.options.environment === 'longtable') packages.add('longtable')
  if (model.latexOrigin?.wrapper.startsWith('sidewaystable')) {
    packages.add('rotating')
  }

  const rowLines: string[] = []
  for (let row = 0; row < model.rows.length; row++) {
    const boundaryRule = renderBoundaryRule(row)
    let latex = boundaryRule ? `${boundaryRule}\n` : ''
    const values: string[] = []
    for (let column = 0; column < model.columns.length; ) {
      const cell = cellAt(model, row, column)!
      if (cell.row < row) {
        values.push('')
        column++
      } else {
        values.push(
          renderCellContent(
            cell,
            model.columns[column],
            packages,
            model.options.style !== 'booktabs'
          )
        )
        column += cell.columnSpan
      }
    }
    latex += `  ${values.join(' & ')} \\\\`
    rowLines.push(latex)
  }
  const trailingRule = renderBoundaryRule(model.rows.length)
  const trailingRules = trailingRule ? [trailingRule] : []

  const environment = model.options.environment
  const position = model.options.environmentPosition
    ? `[${model.options.environmentPosition}]`
    : ''
  const begin = environmentNeedsWidth(environment)
    ? `\\begin{${environment}}{${model.options.targetWidth}}${environment === 'tabular*' ? position : ''}{${columnSpec}}`
    : `\\begin{${environment}}${position}{${columnSpec}}`

  const importedLatex = renderImportedTable(
    model,
    begin,
    rowLines,
    trailingRules,
    escapeLatex
  )
  if (importedLatex) {
    return {
      latex: preservedSource ?? importedLatex,
      packages: [...packages],
      warnings,
    }
  }

  if (environment === 'longtable') {
    const prefix = [
      model.options.caption
        ? `\\caption{${escapeLatex(model.options.caption)}}${model.options.label ? `\\label{${escapeLatex(model.options.label)}}` : ''} \\\\`
        : model.options.label
          ? `\\label{${escapeLatex(model.options.label)}}`
          : '',
    ].filter(Boolean)
    const repeatCount = model.rows.findLastIndex(row => row.repeatOnNewPage) + 1
    const body: string[] = [begin, ...prefix]
    if (repeatCount > 0) {
      warnings.push({
        severity: 'warning',
        message:
          'Repeating longtable headers are generated from the leading marked rows.',
      })
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
    body.push(...trailingRules, `\\end{${environment}}`)
    if (model.options.scale !== 'none') {
      warnings.push({
        severity: 'warning',
        message:
          'Longtable cannot be safely wrapped in resizebox; scaling was ignored.',
      })
    }
    return {
      latex: preservedSource ?? body.join('\n'),
      packages: [...packages],
      warnings,
    }
  }

  let inner = `${begin}\n${[...rowLines, ...trailingRules].join('\n')}\n\\end{${environment}}`
  if (model.options.scale !== 'none') {
    packages.add('graphicx')
    const width =
      model.options.scale === 'textwidth' ? '\\textwidth' : '\\columnwidth'
    inner = `\\resizebox{${width}}{!}{%\n${inner}\n}`
  }

  if (model.latexOrigin?.wrapper === 'standalone') {
    return {
      latex: preservedSource ?? inner,
      packages: [...packages],
      warnings,
    }
  }

  const wrapper = [
    `\\begin{table}${model.options.placement ? `[${model.options.placement}]` : ''}`,
  ]
  if (model.options.centered) wrapper.push('  \\centering')
  wrapper.push(...inner.split('\n').map(line => `  ${line}`))
  if (model.options.caption)
    wrapper.push(`  \\caption{${escapeLatex(model.options.caption)}}`)
  if (model.options.label)
    wrapper.push(`  \\label{${escapeLatex(model.options.label)}}`)
  wrapper.push('\\end{table}')
  return {
    latex: preservedSource ?? wrapper.join('\n'),
    packages: [...packages],
    warnings,
  }
}

const readBalanced = (
  source: string,
  start: number,
  open = '{',
  close = '}'
) => {
  if (source[start] !== open) throw new Error(`Expected ${open}`)
  let depth = 0
  let escaped = false
  for (let index = start; index < source.length; index++) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === open) depth++
    if (character === close && --depth === 0)
      return { value: source.slice(start + 1, index), end: index + 1 }
  }
  throw new Error(`Unclosed ${open}`)
}

const splitTopLevel = (source: string, delimiter: '&' | '\\\\') => {
  const nodes = parseLatexFragment(source)
  const separator = delimiter === '&' ? 'cell' : 'row'
  const result: string[] = []
  let start = 0
  for (const node of nodes) {
    if (node.kind !== 'separator' || node.separator !== separator) continue
    result.push(source.slice(start, node.from))
    start = node.to
  }
  result.push(source.slice(start))
  return result
}

const normalizeLooseRowSeparators = (source: string) => {
  let normalized = ''
  let replacements = 0
  let depth = 0
  let math = false
  let comment = false
  const environmentStack: string[] = []

  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (comment) {
      normalized += character
      if (character === '\n') comment = false
      continue
    }
    if (character === '%' && source[index - 1] !== '\\') {
      comment = true
      normalized += character
      continue
    }
    if (character === '$' && source[index - 1] !== '\\') math = !math
    if (!math) {
      const environmentToken = source
        .slice(index)
        .match(/^\\(begin|end)\{([^{}]+)\}/)
      if (environmentToken?.[1] === 'begin') {
        environmentStack.push(environmentToken[2])
      } else if (environmentToken?.[1] === 'end') {
        const current = environmentStack.at(-1)
        if (current === environmentToken[2]) environmentStack.pop()
      }
      if (character === '{' && source[index - 1] !== '\\') depth++
      if (character === '}' && source[index - 1] !== '\\') depth--
    }

    if (
      source[index - 1] !== '\\' &&
      depth === 0 &&
      !math &&
      !environmentStack.length
    ) {
      const looseSeparator = source
        .slice(index)
        .match(/^\\[ \t\r\n]+(?=\\(?:hline\b|cline\{\d+-\d+\}))/)
      if (looseSeparator) {
        normalized += '\\\\ '
        replacements++
        index += looseSeparator[0].length - 1
        continue
      }
    }
    normalized += character
  }

  return { normalized, replacements }
}

const parseColumns = (specification: string) => {
  const columns: TableColumn[] = []
  const verticalBoundaries = new Set<number>()
  let pendingAlignment: HorizontalAlignment | undefined
  for (let index = 0; index < specification.length; index++) {
    const character = specification[index]
    if (character === '|') {
      verticalBoundaries.add(columns.length)
      continue
    }
    if ('lcrX'.includes(character)) {
      columns.push({
        id: `column-${columns.length}`,
        alignment:
          pendingAlignment ??
          (character === 'l' ? 'left' : character === 'r' ? 'right' : 'center'),
        verticalAlignment: 'top',
        width: character === 'X' ? { mode: 'flex' } : { mode: 'auto' },
      })
      pendingAlignment = undefined
    } else if ('pmb'.includes(character) && specification[index + 1] === '{') {
      const width = readBalanced(specification, index + 1)
      const match = width.value.trim().match(/^([0-9.]+)([a-zA-Z]+)$/)
      if (!match) throw new Error(`Unsupported column width: ${width.value}`)
      columns.push({
        id: `column-${columns.length}`,
        alignment: pendingAlignment ?? 'left',
        verticalAlignment:
          character === 'm' ? 'middle' : character === 'b' ? 'bottom' : 'top',
        width: { mode: 'fixed', value: Number(match[1]), unit: match[2] },
      })
      pendingAlignment = undefined
      index = width.end - 1
    } else if (character === '>' && specification[index + 1] === '{') {
      const modifier = readBalanced(specification, index + 1)
      pendingAlignment = /\\raggedright/.test(modifier.value)
        ? 'left'
        : /\\raggedleft/.test(modifier.value)
          ? 'right'
          : /\\centering/.test(modifier.value)
            ? 'center'
            : undefined
      index = modifier.end - 1
    } else if (!' \t\r\n'.includes(character)) {
      throw new Error(`Unsupported column type: ${character}`)
    }
  }
  if (!columns.length) throw new Error('No supported columns found')
  return { columns, verticalBoundaries }
}

const unwrapCommand = (value: string, command: string) => {
  const trimmed = value.trim()
  const prefix = `\\${command}`
  if (!trimmed.startsWith(prefix)) return
  let cursor = prefix.length
  const args: string[] = []
  while (trimmed[cursor] === '{') {
    const argument = readBalanced(trimmed, cursor)
    args.push(argument.value)
    cursor = argument.end
  }
  if (cursor !== trimmed.length) return
  return args
}

const unwrapLeadingCommand = (value: string, command: string) => {
  const trimmed = value.trim()
  const prefix = '\\' + command
  if (!trimmed.startsWith(prefix)) return
  const cursor = prefix.length
  if (trimmed[cursor] !== '{') return
  const argument = readBalanced(trimmed, cursor)
  return {
    argument: argument.value,
    remainder: trimmed.slice(argument.end).trimStart(),
  }
}

const unwrapMultirow = (value: string) => {
  const trimmed = value.trim()
  const prefix = '\\multirow'
  if (!trimmed.startsWith(prefix)) return
  let cursor = prefix.length
  const skipSpace = () => {
    while (/\s/.test(trimmed[cursor] ?? '')) cursor++
  }
  const read = (optional: boolean) => {
    skipSpace()
    const opening = optional ? '[' : '{'
    if (trimmed[cursor] !== opening) return
    const argument = readBalanced(
      trimmed,
      cursor,
      opening,
      optional ? ']' : '}'
    )
    cursor = argument.end
    return argument.value
  }
  read(true)
  const rows = read(false)
  read(true)
  const width = read(false)
  read(true)
  const content = read(false)
  skipSpace()
  if (rows === undefined || width === undefined || content === undefined) return
  if (cursor !== trimmed.length) return
  const rowSpan = Number(rows.trim())
  if (!Number.isInteger(rowSpan) || rowSpan === 0) return
  return { rowSpan, content }
}

const unwrapMultiline = (value: string) => {
  const trimmed = value.trim()
  const command = trimmed.startsWith('\\shortstack')
    ? 'shortstack'
    : trimmed.startsWith('\\makecell')
      ? 'makecell'
      : undefined
  if (!command) return
  const prefix = `\\${command}`
  let cursor = prefix.length
  if (trimmed[cursor] === '[') {
    const closing = trimmed.indexOf(']', cursor + 1)
    if (closing < 0) return
    cursor = closing + 1
  }
  if (trimmed[cursor] !== '{') return
  const argument = readBalanced(trimmed, cursor)
  if (trimmed.slice(argument.end).trim()) return
  return argument.value
}

const decodeLatexText = (value: string) => {
  const supportedEscape =
    /\\(?:[&%$#_{}]|textasciitilde\{\}|textasciicircum\{\}|textbackslash\{\})/g
  const unsupported = value.replace(supportedEscape, '')
  if (/\\[a-zA-Z]+|[{}$]/.test(unsupported)) return
  return value
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\([&%$#_{}])/g, '$1')
}

const stripLatexComments = (source: string) =>
  source.replace(/(^|[^\\])%[^\n]*(?:\n|$)/g, '$1')

const parseCell = (source: string, row: number, column: number): TableCell => {
  let value = stripLatexComments(source).trim()
  const cell: TableCell = {
    id: 'cell-' + row + '-' + column,
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    content: { text: '' },
    borders: emptyBorders(),
  }
  let unwrapped = true
  while (unwrapped) {
    unwrapped = false
    const multiColumn = unwrapCommand(value, 'multicolumn')
    if (multiColumn?.length === 3) {
      cell.columnSpan = Number(multiColumn[0])
      const multiColumnSpec = multiColumn[1].trim()
      if (multiColumnSpec.startsWith('|')) cell.borders.left = 'solid'
      if (multiColumnSpec.endsWith('|')) cell.borders.right = 'solid'
      const alignment = multiColumnSpec.match(/[lcr]/)?.[0]
      if (alignment) {
        cell.horizontalAlignment =
          alignment === 'l' ? 'left' : alignment === 'r' ? 'right' : 'center'
      }
      value = multiColumn[2]
      unwrapped = true
      continue
    }
    const multiRow = unwrapMultirow(value)
    if (multiRow) {
      cell.rowSpan = multiRow.rowSpan
      value = multiRow.content
      unwrapped = true
      continue
    }
    const cellColor = unwrapLeadingCommand(value, 'cellcolor')
    if (cellColor) {
      cell.backgroundColor = cellColor.argument
      value = cellColor.remainder
      unwrapped = true
      continue
    }
    const textColor = unwrapCommand(value, 'textcolor')
    if (textColor?.length === 2) {
      cell.content.style = { ...cell.content.style, color: textColor[0] }
      value = textColor[1]
      unwrapped = true
      continue
    }
    const bold = unwrapCommand(value, 'textbf')
    if (bold?.length === 1) {
      cell.content.style = { ...cell.content.style, bold: true }
      value = bold[0]
      unwrapped = true
      continue
    }
    const italic = unwrapCommand(value, 'textit')
    if (italic?.length === 1) {
      cell.content.style = { ...cell.content.style, italic: true }
      value = italic[0]
      unwrapped = true
      continue
    }
    const shortstack = unwrapMultiline(value)
    if (shortstack !== undefined) {
      const lines = splitTopLevel(shortstack, '\\\\').map(line =>
        decodeLatexText(line.trim())
      )
      if (lines.every((line): line is string => line !== undefined)) {
        value = lines.join('\n')
        unwrapped = true
      }
    }
  }
  value = value.replace(/\\newline\s*/g, '\n')
  const decoded = decodeLatexText(value)
  if (decoded === undefined) cell.content.rawLatex = value
  else cell.content.text = decoded
  return cell
}

export type ParseResult = {
  model: TableModel
  diagnostics: Diagnostic[]
  unsafe: boolean
}

export type TableEnvironmentLocation = {
  environment: TableEnvironment
  beginStart: number
  beginEnd: number
  endStart: number
  endEnd: number
}

export const locateTableEnvironment = (
  source: string
): TableEnvironmentLocation => {
  const roots: TableEnvironmentLocation[] = []
  const visit = (nodes: LatexNode[], insideSupported = false) => {
    for (const node of nodes) {
      const isSupported =
        node.kind === 'environment' && isTableEnvironment(node.name)
      if (node.kind === 'environment' && isSupported) {
        if (!insideSupported) {
          const beginEnd = source.indexOf('}', node.from) + 1
          roots.push({
            environment: node.name as TableEnvironment,
            beginStart: node.from,
            beginEnd,
            endStart: node.endStart,
            endEnd: node.to,
          })
        }
        continue
      }
      if (node.kind === 'group' || node.kind === 'environment') {
        visit(node.children, insideSupported || isSupported)
      }
      if (node.kind === 'command' || node.kind === 'environment') {
        for (const argument of node.arguments) {
          visit(argument.children, insideSupported || isSupported)
        }
      }
    }
  }
  visit(parseLatexSyntax(source).children)
  if (roots.length !== 1) {
    throw new Error('Enter exactly one supported LaTeX table environment.')
  }
  return roots[0]
}

export const parseLatexTable = (
  source: string,
  allowUnsafe = false
): ParseResult => {
  const diagnostics: Diagnostic[] = []
  const location = locateTableEnvironment(source)
  const environment = location.environment
  const preamble = readTablePreamble(source, location, environment)
  const columnResult = parseColumnSpecification(preamble.specification)
  const { columns, verticalBoundaries } = columnResult
  diagnostics.push(...columnResult.diagnostics)
  const metadataSpans = collectMetadataSpans(source, decodeLatexText)
  const looseRowSeparators = normalizeLooseRowSeparators(preamble.body)
  const parsedBody = parseTableBody(
    looseRowSeparators.normalized,
    preamble.bodyStart,
    environment,
    columns.length,
    metadataSpans
  )
  for (const message of parsedBody.diagnostics) {
    diagnostics.push({ severity: 'warning', message })
  }
  const unsafeCommands = preamble.body.match(
    /\\(cmidrule|specialrule|addlinespace|rowcolor|hhline)\b/g
  )
  const wrapperSource =
    source.slice(0, location.beginStart) + source.slice(location.endEnd)
  const unsafeWrapperCommands = wrapperSource.match(/\\setlength\b/g)
  if (unsafeCommands) {
    diagnostics.push({
      severity: 'warning',
      message: `The table contains unsupported structure: ${[
        ...new Set(unsafeCommands),
      ].join(', ')}`,
    })
  }
  if (unsafeWrapperCommands) {
    diagnostics.push({
      severity: 'warning',
      message: `The table wrapper contains unsupported structure: ${[
        ...new Set(unsafeWrapperCommands),
      ].join(', ')}`,
    })
  }
  if (looseRowSeparators.replacements) {
    diagnostics.push({
      severity: 'warning',
      message: `Found ${looseRowSeparators.replacements} single-backslash row separator${looseRowSeparators.replacements === 1 ? '' : 's'} before \\hline or \\cline. They will be interpreted as \\\\.`,
    })
  }
  let unsafe = Boolean(
    unsafeWrapperCommands ||
    unsafeCommands ||
    parsedBody.diagnostics.length ||
    looseRowSeparators.replacements ||
    columnResult.unsafe
  )
  if (unsafe && !allowUnsafe) {
    return { model: createTableModel(), diagnostics, unsafe: true }
  }
  const { rawRows, rowSections, rulesAtBoundary, sectionLayouts } = parsedBody
  const model = createTableModel(Math.max(1, rawRows.length), columns.length)
  model.columns = columns
  model.cells = {}
  model.options.environment = environment
  model.options.targetWidth = preamble.targetWidth
  model.options.environmentPosition = preamble.environmentPosition
  for (let index = 0; index < model.rows.length; index++) {
    model.rows[index].longtableSection =
      rowSections[index] ?? (environment === 'longtable' ? 'body' : undefined)
    if (environment === 'longtable') {
      model.rows[index].repeatOnNewPage =
        rowSections[index] === 'firstHead' || rowSections[index] === 'head'
    }
  }
  model.options.style = /\\(toprule|midrule|bottomrule)/.test(source)
    ? 'booktabs'
    : 'default'
  model.options.centered = /\\centering\b/.test(source)
  const wrapperName = detectWrapper(source, location.beginStart)
  const wrapper = source
    .slice(0, location.beginStart)
    .match(/\\begin\{(?:table\*?|sidewaystable\*?)\}(?:\[([^\]]*)\])?/)
  if (wrapper?.[1] !== undefined) {
    model.options.placement = wrapper[1]
  }
  model.options.caption =
    metadataSpans.find(command => command.kind === 'caption' && command.primary)
      ?.value ?? ''
  model.options.label =
    metadataSpans.find(command => command.kind === 'label' && command.primary)
      ?.value ?? ''
  model.options.scale = /\\resizebox\{\\textwidth\}/.test(source)
    ? 'textwidth'
    : /\\resizebox\{\\columnwidth\}/.test(source)
      ? 'columnwidth'
      : 'none'
  const grid = buildLatexGrid(
    rawRows.map(row => splitTopLevel(row, '&')),
    model.rows.length,
    model.columns.length,
    parseCell
  )
  model.cells = grid.cells
  diagnostics.push(...grid.diagnostics)
  unsafe ||= grid.unsafe
  if (grid.unsafe && !allowUnsafe) {
    return { model: createTableModel(), diagnostics, unsafe: true }
  }
  const crossesSection = getCells(model).some(cell => {
    const sections = new Set(
      model.rows
        .slice(cell.row, cell.row + cell.rowSpan)
        .map(row => row.longtableSection ?? 'body')
    )
    return sections.size > 1
  })
  if (crossesSection) {
    unsafe = true
    diagnostics.push({
      severity: 'warning',
      message: 'A multirow cell cannot cross a longtable section boundary.',
    })
    if (!allowUnsafe) {
      return { model: createTableModel(), diagnostics, unsafe: true }
    }
  }
  for (const cell of getCells(model)) {
    if (cell.columnSpan === 1) {
      if (verticalBoundaries.has(cell.column)) cell.borders.left = 'solid'
      if (verticalBoundaries.has(cell.column + 1)) cell.borders.right = 'solid'
      if (cell.horizontalAlignment === model.columns[cell.column].alignment) {
        cell.horizontalAlignment = undefined
      }
    }
  }
  for (const [boundary, ranges] of rulesAtBoundary) {
    for (const [from, to] of ranges) {
      for (let column = from; column <= to; column++) {
        if (boundary === model.rows.length) {
          const cell = cellAt(model, boundary - 1, column)
          if (cell && cell.row + cell.rowSpan === boundary)
            cell.borders.bottom = 'solid'
        } else {
          const cell = cellAt(model, boundary, column)
          if (cell?.row === boundary) cell.borders.top = 'solid'
        }
      }
    }
  }
  const longtableLayouts: LatexLongtableSectionLayout[] | undefined =
    environment === 'longtable'
      ? sectionLayouts.map(section => ({
          kind: section.kind,
          marker: section.marker,
          prefixTemplate: section.prefixTemplate,
          suffixTemplate: section.suffixTemplate,
          fragments: section.pending.map(fragment => ({
            beforeRowId:
              fragment.beforeRowIndex === undefined
                ? undefined
                : model.rows[fragment.beforeRowIndex]?.id,
            template: fragment.template,
          })),
        }))
      : undefined
  model.unsafeImport = unsafe
  model.diagnostics = diagnostics
  assertModel(model)
  attachLatexOrigin(model, source, wrapperName, {
    wrapper: wrapperName,
    beforeGridTemplate: templateSourceRange(
      source,
      0,
      location.beginStart,
      metadataSpans
    ),
    afterGridTemplate: templateSourceRange(
      source,
      location.endEnd,
      source.length,
      metadataSpans
    ),
    metadata: metadataSpans.map(
      ({ from: _from, to: _to, ...command }) => command
    ),
    gridEnvironment: environment,
    sections: longtableLayouts,
  })
  return { model, diagnostics, unsafe }
}

export const fingerprintSource = (source: string) =>
  generateSHA1Hash(`visual-table:${source.length}:${source}`)
