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
    packages.add('xcolor')
    value = `\\textcolor{${cell.content.style.color}}{${value}}`
  }
  if (cell.backgroundColor) {
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

const horizontalRules = (model: TableModel, row: number) => {
  if (model.options.style === 'booktabs') {
    if (row === 0) return '\\toprule\n'
    if (row === 1) return '\\midrule\n'
    return ''
  }
  const cells = getCells(model).filter(cell => cell.row === row)
  const bordered = cells.filter(cell => cell.borders.top !== 'none')
  if (!bordered.length) return ''
  if (bordered.length === cells.length) return '\\hline\n'
  const intervals = bordered
    .map(cell => [cell.column + 1, cell.column + cell.columnSpan] as const)
    .sort((a, b) => a[0] - b[0])
  return `${intervals.map(([from, to]) => `\\cline{${from}-${to}}`).join(' ')}\n`
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

  const rowLines: string[] = []
  for (let row = 0; row < model.rows.length; row++) {
    let latex = horizontalRules(model, row)
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
    const bottom = getCells(model).filter(
      cell =>
        cell.row + cell.rowSpan === model.rows.length &&
        cell.borders.bottom !== 'none'
    )
    if (
      bottom.length ===
        getCells(model).filter(
          cell => cell.row + cell.rowSpan === model.rows.length
        ).length &&
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
      if (character === '{' && source[index - 1] !== '\\') depth++
      if (character === '}' && source[index - 1] !== '\\') depth--
    }
    if (depth !== 0 || math) continue
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

const parseCell = (source: string, row: number, column: number): TableCell => {
  let value = source.trim()
  const cell: TableCell = {
    id: `cell-${row}-${column}`,
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    content: { text: '' },
    borders: emptyBorders(),
  }
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
  }
  const multiRow = unwrapCommand(value, 'multirow')
  if (multiRow?.length === 3) {
    cell.rowSpan = Number(multiRow[0])
    value = multiRow[2]
  }
  const bold = unwrapCommand(value, 'textbf')
  if (bold?.length === 1) {
    cell.content.style = { bold: true }
    value = bold[0]
  }
  const italic = unwrapCommand(value, 'textit')
  if (italic?.length === 1) {
    cell.content.style = { ...cell.content.style, italic: true }
    value = italic[0]
  }
  // Imported content remains opaque unless it is plain text. This prevents double escaping.
  if (/\\[a-zA-Z]+|[{}$]/.test(value)) cell.content.rawLatex = value
  else cell.content.text = value.replace(/\\([&%$#_{}])/g, '$1')
  return cell
}

export type ParseResult = {
  model: TableModel
  diagnostics: Diagnostic[]
  unsafe: boolean
}

export const parseLatexTable = (
  source: string,
  allowUnsafe = false
): ParseResult => {
  const diagnostics: Diagnostic[] = []
  const environmentMatch = source.match(
    /\\begin\{(tabularx|tabular|longtable)\}/
  )
  if (!environmentMatch) throw new Error('No supported table environment found')
  const environment = environmentMatch[1] as TableEnvironment
  let cursor = environmentMatch.index! + environmentMatch[0].length
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
  const endMarker = `\\end{${environment}}`
  const end = source.indexOf(endMarker, specification.end)
  if (end < 0) throw new Error(`Missing ${endMarker}`)
  let body = source.slice(specification.end, end)
  const unsafeCommands = body.match(
    /\\(cmidrule|specialrule|addlinespace|rowcolor|hhline|endfirsthead|endhead|endfoot|endlastfoot)\b/g
  )
  let unsafe = Boolean(unsafeCommands)
  if (unsafe) {
    diagnostics.push({
      severity: 'warning',
      message: `The table contains unsupported structure: ${[...new Set(unsafeCommands)].join(', ')}`,
    })
    if (!allowUnsafe) {
      return { model: createTableModel(), diagnostics, unsafe: true }
    }
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
  model.options.caption = source.match(/\\caption\{([^{}]*)\}/)?.[1] ?? ''
  model.options.label = source.match(/\\label\{([^{}]*)\}/)?.[1] ?? ''
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
  model.unsafeImport = unsafe
  model.diagnostics = diagnostics
  assertModel(model)
  return { model, diagnostics, unsafe }
}

export const fingerprintSource = (source: string) =>
  generateSHA1Hash(`visual-table:${source.length}:${source}`)
