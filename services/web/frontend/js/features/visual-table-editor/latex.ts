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
} from './types'
import { assertModel, cellAt, getCells } from './model'

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

const horizontalRules = (
  model: TableModel,
  row: number,
  cells: TableCell[]
) => {
  if (model.options.style === 'booktabs') {
    if (row === 0) return '\\toprule\n'
    if (row === 1) return '\\midrule\n'
    return ''
  }
  const intervals = cells
    .filter(cell => cell.borders.top !== 'none')
    .map(cell => [cell.column + 1, cell.column + cell.columnSpan] as const)
    .sort((a, b) => a[0] - b[0])
  if (!intervals.length) return ''

  const merged: Array<[number, number]> = []
  for (const [from, to] of intervals) {
    const previous = merged.at(-1)
    if (previous && from <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], to)
    } else {
      merged.push([from, to])
    }
  }
  if (
    merged.length === 1 &&
    merged[0][0] === 1 &&
    merged[0][1] === model.columns.length
  ) {
    return '\\hline\n'
  }
  return (
    merged
      .map(([from, to]) => '\\cline{' + from + '-' + to + '}')
      .join(' ') + '\n'
  )
}

export type GenerationResult = {
  latex: string
  packages: string[]
  warnings: Diagnostic[]
}

export const generateLatex = (model: TableModel): GenerationResult => {
  assertModel(model)
  const packages = new Set<string>()
  const warnings: Diagnostic[] = []
  const columnSpec = model.columns.map(generateColumn).join('')
  if (model.columns.some(column => column.width.mode === 'fixed')) {
    packages.add('array')
  }
  if (model.options.style === 'booktabs') packages.add('booktabs')
  if (model.options.environment === 'tabularx') packages.add('tabularx')
  if (model.options.environment === 'longtable') packages.add('longtable')

  const cells = getCells(model)
  const cellsByRow = new Map<number, TableCell[]>()
  for (const cell of cells) {
    const rowCells = cellsByRow.get(cell.row) ?? []
    rowCells.push(cell)
    cellsByRow.set(cell.row, rowCells)
  }

  const rowLines: string[] = []
  for (let row = 0; row < model.rows.length; row++) {
    let latex = horizontalRules(model, row, cellsByRow.get(row) ?? [])
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
  const trailingRules: string[] = []
  if (model.options.style === 'booktabs') trailingRules.push('\\bottomrule')
  else {
    const bottom = cells.filter(
      cell =>
        cell.row + cell.rowSpan === model.rows.length &&
        cell.borders.bottom !== 'none'
    )
    if (
      bottom.length ===
        cells.filter(cell => cell.row + cell.rowSpan === model.rows.length)
          .length &&
      bottom.length
    ) {
      trailingRules.push('\\hline')
    }
  }

  const environment = model.options.environment
  const begin =
    environment === 'tabularx'
      ? `\\begin{tabularx}{${model.options.targetWidth}}{${columnSpec}}`
      : `\\begin{${environment}}{${columnSpec}}`
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
    return { latex: body.join('\n'), packages: [...packages], warnings }
  }

  let inner = `${begin}\n${[...rowLines, ...trailingRules].join('\n')}\n\\end{${environment}}`
  if (model.options.scale !== 'none') {
    packages.add('graphicx')
    const width =
      model.options.scale === 'textwidth' ? '\\textwidth' : '\\columnwidth'
    inner = `\\resizebox{${width}}{!}{%\n${inner}\n}`
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
  return { latex: wrapper.join('\n'), packages: [...packages], warnings }
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
  const result: string[] = []
  let start = 0
  let depth = 0
  let math = false
  let comment = false
  const environmentStack: string[] = []
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (comment) {
      if (character === '\n') comment = false
      continue
    }
    if (character === '%' && source[index - 1] !== '\\') {
      comment = true
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
    if (depth !== 0 || math || environmentStack.length) continue
    if (delimiter === '&' && character === '&' && source[index - 1] !== '\\') {
      result.push(source.slice(start, index))
      start = index + 1
    }
    if (
      delimiter === '\\\\' &&
      character === '\\' &&
      source[index + 1] === '\\'
    ) {
      result.push(source.slice(start, index))
      start = index + 2
      index++
    }
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

const unwrapShortstack = (value: string) => {
  const trimmed = value.trim()
  const prefix = '\\shortstack'
  if (!trimmed.startsWith(prefix)) return
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

const readCommandArgument = (source: string, command: string) => {
  const prefix = '\\' + command
  const start = source.indexOf(prefix)
  if (start < 0) return
  let cursor = start + prefix.length
  while (/\s/.test(source[cursor])) cursor++
  if (source[cursor] !== '{') return
  return readBalanced(source, cursor).value
}

const parseCell = (source: string, row: number, column: number): TableCell => {
  let value = source.trim()
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
    const multiRow = unwrapCommand(value, 'multirow')
    if (multiRow?.length === 3) {
      cell.rowSpan = Number(multiRow[0])
      value = multiRow[2]
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
    const shortstack = unwrapShortstack(value)
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
  const tokens = source.matchAll(
    /\\(begin|end)\{(tabularx|tabular|longtable)\}/g
  )
  const stack: Array<{
    environment: TableEnvironment
    beginStart: number
    beginEnd: number
  }> = []
  const roots: TableEnvironmentLocation[] = []

  for (const token of tokens) {
    const kind = token[1]
    const environment = token[2] as TableEnvironment
    const start = token.index ?? 0
    if (kind === 'begin') {
      stack.push({
        environment,
        beginStart: start,
        beginEnd: start + token[0].length,
      })
      continue
    }

    const opening = stack.pop()
    if (!opening || opening.environment !== environment) {
      throw new Error('The supported LaTeX table environment is not balanced.')
    }
    if (!stack.length) {
      roots.push({
        ...opening,
        endStart: start,
        endEnd: start + token[0].length,
      })
    }
  }

  if (stack.length) {
    throw new Error(`Missing \\end{${stack[0].environment}}`)
  }
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
  let cursor = location.beginEnd
  let targetWidth = '\\textwidth'
  if (environment === 'tabularx') {
    while (/\s/.test(source[cursor])) cursor++
    const width = readBalanced(source, cursor)
    targetWidth = width.value
    cursor = width.end
  }
  while (/\s/.test(source[cursor])) cursor++
  const specification = readBalanced(source, cursor)
  const { columns, verticalBoundaries } = parseColumns(specification.value)
  let body = source.slice(specification.end, location.endStart)
  let repeatHeaderRowCount = 0
  let malformedLongtableHeaders = false
  if (environment === 'longtable') {
    const caption = unwrapLeadingCommand(body, 'caption')
    if (caption) body = caption.remainder
    const label = unwrapLeadingCommand(body, 'label')
    if (label) body = label.remainder
    if (body.trimStart().startsWith('\\\\')) {
      body = body.trimStart().slice(2)
    }

    const firstHead = body.indexOf('\\endfirsthead')
    const repeatedHead = body.indexOf('\\endhead')
    if (firstHead >= 0 && repeatedHead > firstHead) {
      const repeated = body.slice(
        firstHead + '\\endfirsthead'.length,
        repeatedHead
      )
      repeatHeaderRowCount = splitTopLevel(repeated, '\\\\').filter(chunk =>
        chunk
          .replace(
            /\\(?:hline|cline\{\d+-\d+\}|toprule|midrule|bottomrule)\s*/g,
            ''
          )
          .trim()
      ).length
      body = repeated + body.slice(repeatedHead + '\\endhead'.length)
    } else if (firstHead >= 0 || repeatedHead >= 0) {
      malformedLongtableHeaders = true
    }
  }
  const looseRowSeparators = normalizeLooseRowSeparators(body)
  body = looseRowSeparators.normalized
  const unsafeCommands = body.match(
    /\\(cmidrule|specialrule|addlinespace|rowcolor|hhline|endfoot|endlastfoot)\b/g
  )
  const wrapperSource =
    source.slice(0, location.beginStart) + source.slice(location.endEnd)
  const unsafeWrapperCommands = wrapperSource.match(/\\setlength\b/g)
  let unsafe = Boolean(
    unsafeCommands ||
      unsafeWrapperCommands ||
      malformedLongtableHeaders ||
      looseRowSeparators.replacements
  )
  if (unsafeCommands) {
    diagnostics.push({
      severity: 'warning',
      message: `The table contains unsupported structure: ${[...new Set(unsafeCommands)].join(', ')}`,
    })
  }
  if (malformedLongtableHeaders) {
    diagnostics.push({
      severity: 'warning',
      message:
        'The longtable header must contain both \\endfirsthead and \\endhead.',
    })
  }
  if (unsafeWrapperCommands) {
    diagnostics.push({
      severity: 'warning',
      message: `The table wrapper contains unsupported structure: ${[...new Set(unsafeWrapperCommands)].join(', ')}`,
    })
  }
  if (looseRowSeparators.replacements) {
    diagnostics.push({
      severity: 'warning',
      message: `Found ${looseRowSeparators.replacements} single-backslash row separator${looseRowSeparators.replacements === 1 ? '' : 's'} before \\hline or \\cline. They will be interpreted as \\\\.`,
    })
  }
  if (unsafe && !allowUnsafe) {
    return { model: createTableModel(), diagnostics, unsafe: true }
  }
  const rawRows: string[] = []
  const rulesAtBoundary = new Map<number, Array<readonly [number, number]>>()
  for (const chunk of splitTopLevel(body, '\\\\')) {
    const boundary = rawRows.length
    const rules: Array<readonly [number, number]> = []
    const content = chunk.replace(
      /\\(?:hline|cline\{(\d+)-(\d+)\}|toprule|midrule|bottomrule)\s*/g,
      (_match, from?: string, to?: string) => {
        if (from && to) rules.push([Number(from) - 1, Number(to) - 1])
        else if (/\\hline/.test(_match)) rules.push([0, columns.length - 1])
        return ''
      }
    )
    if (rules.length) {
      rulesAtBoundary.set(boundary, [
        ...(rulesAtBoundary.get(boundary) ?? []),
        ...rules,
      ])
    }
    if (content.trim()) rawRows.push(content)
  }
  const model = createTableModel(Math.max(1, rawRows.length), columns.length)
  model.columns = columns
  model.cells = {}
  model.options.environment = environment
  model.options.targetWidth = targetWidth
  model.options.style = /\\(toprule|midrule|bottomrule)/.test(source)
    ? 'booktabs'
    : 'default'
  model.options.centered = /\\centering\b/.test(source)
  const wrapper = source.match(/\\begin\{table\}(?:\[([^\]]*)\])?/)
  if (wrapper?.[1] !== undefined) {
    model.options.placement = wrapper[1]
  }
  const captionArgument = readCommandArgument(source, 'caption') ?? ''
  model.options.caption = decodeLatexText(captionArgument) ?? captionArgument
  const labelArgument = readCommandArgument(source, 'label') ?? ''
  model.options.label = decodeLatexText(labelArgument) ?? labelArgument
  model.options.scale = /\\resizebox\{\\textwidth\}/.test(source)
    ? 'textwidth'
    : /\\resizebox\{\\columnwidth\}/.test(source)
      ? 'columnwidth'
      : 'none'
  const occupied = new Set<string>()
  rawRows.forEach((rowSource, row) => {
    let column = 0
    for (const value of splitTopLevel(rowSource, '&')) {
      let consumedMergedPlaceholder = false
      while (occupied.has(`${row}:${column}`)) {
        column++
        if (!value.trim()) {
          consumedMergedPlaceholder = true
          break
        }
      }
      if (consumedMergedPlaceholder) continue
      if (column >= columns.length) {
        unsafe = true
        diagnostics.push({
          severity: 'warning',
          message: `Row ${row + 1} has too many cells.`,
        })
        break
      }
      const cell = parseCell(value, row, column)
      if (
        cell.row + cell.rowSpan > rawRows.length ||
        cell.column + cell.columnSpan > columns.length
      ) {
        unsafe = true
        diagnostics.push({
          severity: 'warning',
          message: `Merged cell at row ${row + 1} is outside the table.`,
        })
        cell.rowSpan = 1
        cell.columnSpan = 1
      }
      model.cells[cell.id] = cell
      for (let y = row; y < row + cell.rowSpan; y++)
        for (let x = column; x < column + cell.columnSpan; x++)
          occupied.add(`${y}:${x}`)
      column += cell.columnSpan
    }
  })
  for (let row = 0; row < model.rows.length; row++) {
    for (let column = 0; column < model.columns.length; column++) {
      if (!occupied.has(`${row}:${column}`)) {
        const cell = parseCell('', row, column)
        model.cells[cell.id] = cell
      }
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
  for (
    let row = 0;
    row < repeatHeaderRowCount && row < model.rows.length;
    row++
  ) {
    model.rows[row].repeatOnNewPage = true
  }
  model.unsafeImport = unsafe
  model.diagnostics = diagnostics
  assertModel(model)
  return { model, diagnostics, unsafe }
}

export const fingerprintSource = (source: string) =>
  generateSHA1Hash(`visual-table:${source.length}:${source}`)
