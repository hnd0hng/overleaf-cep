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
import { parseColumnSpecification } from './latex/column-spec'
import { isTableEnvironment } from './latex/environment'
import {
  generateCanonicalLatex,
  type GenerationResult,
} from './latex/generator/canonical-renderer'
import { buildLatexGrid } from './latex/grid-builder'
import { parseLatexFragment, parseLatexSyntax } from './latex/parser'
import { unwrapNestedCellTable } from './latex/nested-cell-table'
import type { LatexNode } from './latex/syntax-tree'
import { readTablePreamble, parseTableBody } from './latex/import-structure'
import { collectMetadataSpans, detectWrapper } from './latex/source-layout'

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

export type { GenerationResult }

export const generateLatex = (model: TableModel): GenerationResult =>
  generateCanonicalLatex(model, escapeLatex)

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
  const command: 'shortstack' | 'makecell' | undefined = trimmed.startsWith(
    '\\shortstack'
  )
    ? 'shortstack'
    : trimmed.startsWith('\\makecell')
      ? 'makecell'
      : undefined
  if (!command) return
  const prefix = `\\${command}`
  let cursor = prefix.length
  let alignment: HorizontalAlignment | undefined
  if (trimmed[cursor] === '[') {
    const option = readBalanced(trimmed, cursor, '[', ']')
    const alignmentToken = option.value.trim().match(/[lcr]/)?.[0]
    alignment =
      alignmentToken === 'l'
        ? 'left'
        : alignmentToken === 'r'
          ? 'right'
          : alignmentToken === 'c'
            ? 'center'
            : undefined
    cursor = option.end
  }
  if (trimmed[cursor] !== '{') return
  const argument = readBalanced(trimmed, cursor)
  if (trimmed.slice(argument.end).trim()) return
  return { content: argument.value, alignment, command }
}

const decodeLatexText = (value: string) => {
  const supportedEscape =
    /\\(?:[&%$#_{}]|textasciitilde\{\}|textasciicircum\{\}|textbackslash\{\})/g
  const unsupported = value.replace(supportedEscape, '')
  if (/\\.|[{}$]/.test(unsupported)) return
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
      if (multiColumnSpec.startsWith('||')) cell.borders.left = 'double'
      else if (multiColumnSpec.startsWith('|')) cell.borders.left = 'solid'
      if (multiColumnSpec.endsWith('||')) cell.borders.right = 'double'
      else if (multiColumnSpec.endsWith('|')) cell.borders.right = 'solid'
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
    const nestedTable = unwrapNestedCellTable(value)
    if (nestedTable) {
      const decodedLines = nestedTable.lines.map(line =>
        decodeLatexText(line.trim())
      )
      value = decodedLines.every((line): line is string => line !== undefined)
        ? decodedLines.join('\n')
        : nestedTable.lines.join('\n')
      if (nestedTable.alignment) {
        cell.horizontalAlignment ??= nestedTable.alignment
      }
      cell.latexPresentation = { multiline: 'flattened-table' }
      unwrapped = true
      continue
    }
    const multiline = unwrapMultiline(value)
    if (multiline !== undefined) {
      const lines = splitTopLevel(multiline.content, '\\\\').map(line =>
        decodeLatexText(line.trim())
      )
      if (lines.every((line): line is string => line !== undefined)) {
        value = lines.join('\n')
        cell.horizontalAlignment ??= multiline.alignment
        cell.latexPresentation = {
          multiline: multiline.command,
          alignment: multiline.alignment,
        }
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

const collectTableDirectives = (
  source: string,
  location: TableEnvironmentLocation,
  metadata: ReturnType<typeof collectMetadataSpans>,
  bodyStart: number,
  body: string
) => {
  const candidates: Array<{
    index: number
    end: number
    kind:
      | 'centering'
      | 'caption'
      | 'label'
      | 'tabcolsep'
      | 'arraystretch'
      | 'font-size'
      | 'rowcolors'
    value?: string
    arguments?: string[]
    scoped?: boolean
  }> = metadata
    .filter(command => command.primary)
    .map(command => ({
      index: command.from,
      end: command.to,
      kind: command.kind,
    }))

  const outsideGrid = (index: number) =>
    index < location.beginStart || index >= location.endEnd
  const collect = (
    pattern: RegExp,
    kind: 'centering' | 'tabcolsep' | 'arraystretch' | 'font-size',
    value?: (match: RegExpMatchArray) => string | undefined
  ) => {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined || !outsideGrid(match.index)) continue
      candidates.push({
        index: match.index,
        end: match.index + match[0].length,
        kind,
        value: value?.(match),
        scoped:
          (kind === 'tabcolsep' || kind === 'arraystretch') &&
          source.slice(0, match.index).trimEnd().endsWith('{'),
      })
    }
  }
  collect(/\\centering\b/g, 'centering')
  collect(
    /\\setlength\s*\{\s*\\tabcolsep\s*\}\s*\{([^{}]+)\}/g,
    'tabcolsep',
    match => match[1].trim()
  )
  collect(
    /\\renewcommand\s*\{\s*\\arraystretch\s*\}\s*\{([^{}]+)\}/g,
    'arraystretch',
    match => match[1].trim()
  )
  collect(
    /\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b/g,
    'font-size',
    match => match[1]
  )
  for (const match of source.matchAll(
    /\\rowcolors\s*\{([^{}]+)\}\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g
  )) {
    if (match.index === undefined || !outsideGrid(match.index)) continue
    candidates.push({
      index: match.index,
      end: match.index + match[0].length,
      kind: 'rowcolors',
      arguments: [match[1].trim(), match[2].trim(), match[3].trim()],
    })
  }

  const rowSeparators = parseLatexFragment(body).filter(
    node => node.kind === 'separator' && node.separator === 'row'
  )
  const lastRowEnd = bodyStart + (rowSeparators.at(-1)?.to ?? body.length)
  const hasTableContentAfter = (candidate: (typeof candidates)[number]) => {
    const end = location.endStart
    const excluded = metadata
      .filter(command => command.from >= candidate.end && command.from < end)
      .sort((left, right) => left.from - right.from)
    let cursor = candidate.end
    let remainder = ''
    for (const command of excluded) {
      remainder += source.slice(cursor, command.from)
      cursor = command.to
    }
    remainder += source.slice(cursor, end)
    return Boolean(
      remainder
        .replace(/%[^\n]*/g, '')
        .replace(/\\\\(?:\[[^\]]*\])?/g, '')
        .replace(/\\(?:endfirsthead|endhead|endfoot|endlastfoot)\b/g, '')
        .replace(/\\(?:hline|toprule|midrule|bottomrule)\b/g, '')
        .replace(/\\(?:cline|cmidrule)(?:\([^)]*\))?\s*\{\d+\s*-\s*\d+\}/g, '')
        .trim()
    )
  }
  return candidates
    .sort((left, right) => left.index - right.index)
    .map((candidate, order) => ({
      kind: candidate.kind,
      value: candidate.value,
      arguments: candidate.arguments,
      scoped: candidate.scoped,
      position:
        candidate.index < location.beginStart ||
        (candidate.index >= location.beginStart &&
          (location.environment === 'longtable'
            ? hasTableContentAfter(candidate)
            : candidate.index < lastRowEnd))
          ? ('before-grid' as const)
          : ('after-grid' as const),
      order,
    }))
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
    /\\(specialrule|addlinespace|hhline)\b/g
  )
  const trimmedCmidrules = preamble.body.match(/\\cmidrule\s*\(/g)
  const wrapperSource =
    source.slice(0, location.beginStart) + source.slice(location.endEnd)
  const unsupportedWrapperSource = wrapperSource
    .replace(/\\setlength\s*\{\s*\\tabcolsep\s*\}\s*\{[^{}]+\}/g, '')
    .replace(/\\renewcommand\s*\{\s*\\arraystretch\s*\}\s*\{[^{}]+\}/g, '')
  const unsafeWrapperCommands = unsupportedWrapperSource.match(
    /\\(?:setlength|renewcommand)\b/g
  )
  const unsafeOuterStructures = wrapperSource.match(
    /\\begin\{(?:threeparttable|tablenotes|landscape|center|adjustbox|minipage)\}|\\(?:rotatebox|scalebox)\b/g
  )
  if (trimmedCmidrules) {
    diagnostics.push({
      severity: 'warning',
      message:
        'Trim options on \\cmidrule are not supported and will be removed.',
    })
  }
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
  if (unsafeOuterStructures) {
    diagnostics.push({
      severity: 'warning',
      message: `Unsupported outer table structure will be removed: ${[
        ...new Set(unsafeOuterStructures),
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
    unsafeOuterStructures ||
    unsafeCommands ||
    trimmedCmidrules ||
    parsedBody.diagnostics.length ||
    looseRowSeparators.replacements ||
    columnResult.unsafe
  )
  if (unsafe && !allowUnsafe) {
    return { model: createTableModel(), diagnostics, unsafe: true }
  }
  const { rawRows, rowSections, rowColors, rulesAtBoundary, sectionLayouts } =
    parsedBody
  const model = createTableModel(Math.max(1, rawRows.length), columns.length)
  model.columns = columns
  model.columnBoundaries = verticalBoundaries
  model.cells = {}
  model.options.environment = environment
  model.options.targetWidth = preamble.targetWidth
  model.options.environmentPosition = preamble.environmentPosition
  model.options.longtableMarkers =
    environment === 'longtable'
      ? sectionLayouts
          .map(section => section.marker)
          .filter((marker): marker is string => Boolean(marker))
      : undefined
  for (let index = 0; index < model.rows.length; index++) {
    model.rows[index].longtableSection =
      rowSections[index] ?? (environment === 'longtable' ? 'body' : undefined)
    model.rows[index].backgroundColor = rowColors[index]
    if (environment === 'longtable') {
      model.rows[index].repeatOnNewPage =
        rowSections[index] === 'firstHead' || rowSections[index] === 'head'
    }
  }
  if (environment === 'longtable') {
    const supportedRules = (template: string) =>
      template.match(
        /\\(?:hline|toprule|midrule|bottomrule|(?:cline|cmidrule)(?:\([^)]*\))?\s*\{\d+\s*-\s*\d+\})/g
      ) ?? []
    model.options.longtableSectionRules = {}
    for (const section of sectionLayouts) {
      const rowIndexes = model.rows
        .map((row, index) => ({ row, index }))
        .filter(item => (item.row.longtableSection ?? 'body') === section.kind)
        .map(item => item.index)
      const firstRowIndex = rowIndexes.at(0)
      model.options.longtableSectionRules[section.kind] = {
        prefix:
          firstRowIndex === undefined
            ? []
            : section.pending
                .filter(fragment => fragment.beforeRowIndex === firstRowIndex)
                .flatMap(fragment => supportedRules(fragment.template)),
        suffix: section.pending
          .filter(fragment => fragment.beforeRowIndex === undefined)
          .flatMap(fragment => supportedRules(fragment.template)),
      }
    }
  }
  model.options.style = /\\(toprule|midrule|bottomrule|cmidrule)/.test(source)
    ? 'booktabs'
    : 'default'
  const wrapperName = detectWrapper(source, location.beginStart)
  model.options.wrapper = wrapperName
  model.options.directives = collectTableDirectives(
    source,
    location,
    metadataSpans,
    preamble.bodyStart,
    preamble.body
  )
  model.options.centered = model.options.directives.some(
    directive => directive.kind === 'centering'
  )
  const wrapper = source
    .slice(0, location.beginStart)
    .match(/\\begin\{(?:table\*?|sidewaystable\*?)\}(?:\[([^\]]*)\])?/)
  model.options.placement =
    wrapperName === 'standalone' ? '' : (wrapper?.[1] ?? '')
  const primaryCaption = metadataSpans.find(
    command => command.kind === 'caption' && command.primary
  )
  model.options.caption = primaryCaption?.value ?? ''
  model.options.captionIsLatex =
    primaryCaption !== undefined &&
    decodeLatexText(primaryCaption.value) === undefined
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
      cell.borders.left = verticalBoundaries[cell.column] ?? 'none'
      cell.borders.right = verticalBoundaries[cell.column + 1] ?? 'none'
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
  model.unsafeImport = unsafe
  model.diagnostics = diagnostics
  assertModel(model)
  return { model, diagnostics, unsafe }
}

export const fingerprintSource = (source: string) =>
  generateSHA1Hash(`visual-table:${source.length}:${source}`)
