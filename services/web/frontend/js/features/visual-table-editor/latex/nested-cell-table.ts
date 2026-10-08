import type { HorizontalAlignment } from '../types'
import { parseLatexFragment } from './parser'
import { trimNodes, type LatexArgument, type LatexNode } from './syntax-tree'

export type NestedCellTable = {
  alignment?: HorizontalAlignment
  lines: string[]
}

const skipBalancedGroup = (source: string, start: number) => {
  if (source[start] !== '{') return
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === '\\') {
      index++
      continue
    }
    if (source[index] === '{') depth++
    if (source[index] === '}' && --depth === 0) return index + 1
  }
}

const readSingleColumnAlignment = (
  specification: string
): HorizontalAlignment | undefined => {
  let simplified = ''
  for (let index = 0; index < specification.length; index++) {
    const character = specification[index]
    if (/\s/.test(character)) continue
    if (character === '@' && specification[index + 1] === '{') {
      const end = skipBalancedGroup(specification, index + 1)
      if (end === undefined) return
      index = end - 1
      continue
    }
    simplified += character
  }
  if (!/^[lcr]$/.test(simplified)) return
  return simplified === 'l' ? 'left' : simplified === 'r' ? 'right' : 'center'
}

const NESTED_CELL_TABLE_ENVIRONMENTS = new Set([
  'tabular',
  'tabular*',
  'tabularx',
  'tabularx*',
  'tabulary',
  'tabu',
  'longtabu',
  'tblr',
  'longtblr',
  'talltblr',
  'xltabular',
  'longtable',
  'array',
  'NiceTabular',
  'NiceTabularX',
  'NiceArray',
])

const TABLE_STRUCTURE_COMMANDS = new Set([
  'hline',
  'cline',
  'cmidrule',
  'toprule',
  'midrule',
  'bottomrule',
  'hhline',
  'cdashline',
  'specialrule',
  'addlinespace',
  'noalign',
  'cellcolor',
  'rowcolor',
  'columncolor',
  'arrayrulecolor',
])

const CONTENT_ARGUMENT_COMMANDS = new Set([
  'multicolumn',
  'multirow',
  'makecell',
  'shortstack',
])

const SEMANTIC_LINE_BREAK = '\u0000'

type EnvironmentNode = Extract<LatexNode, { kind: 'environment' }>

const argumentSource = (source: string, argument: LatexArgument) =>
  source.slice(argument.from + 1, argument.to - 1)

const normalizeCell = (value: string) =>
  value
    .split(SEMANTIC_LINE_BREAK)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

const tableSpecification = (source: string, environment: EnvironmentNode) => {
  const argument = environment.arguments.findLast(item => !item.optional)
  if (argument) return argumentSource(source, argument)

  // tabu and longtabu also accept `to <width> {<column specification>}`.
  // Their preamble is parsed as body nodes because it is not a regular LaTeX
  // argument, so use the first group as the column specification.
  if (environment.name === 'tabu' || environment.name === 'longtabu') {
    const specification = environment.children.find(
      node => node.kind === 'group'
    )
    if (specification?.kind === 'group') {
      return source.slice(specification.from + 1, specification.to - 1)
    }
  }
}

const tabularrayColumnSpecification = (specification: string) => {
  const match = /(?:^|,)\s*colspec\s*=\s*/.exec(specification)
  if (!match) return specification
  const start = match.index + match[0].length
  if (specification[start] !== '{') return specification.slice(start).trim()
  const end = skipBalancedGroup(specification, start)
  return end === undefined
    ? specification
    : specification.slice(start + 1, end - 1)
}

const bodyNodes = (environment: EnvironmentNode) => {
  if (environment.name !== 'tabu' && environment.name !== 'longtabu') {
    return environment.children
  }
  if (environment.arguments.length) return environment.children
  const specificationIndex = environment.children.findIndex(
    node => node.kind === 'group'
  )
  return specificationIndex < 0
    ? environment.children
    : environment.children.slice(specificationIndex + 1)
}

const flattenMathTable = (source: string, node: LatexNode) => {
  const math = source.slice(node.from, node.to)
  const delimiters = math.startsWith('$$')
    ? { opening: '$$', closing: '$$' }
    : math.startsWith('$')
      ? { opening: '$', closing: '$' }
      : math.startsWith('\\(')
        ? { opening: '\\(', closing: '\\)' }
        : math.startsWith('\\[')
          ? { opening: '\\[', closing: '\\]' }
          : undefined
  if (!delimiters || !math.endsWith(delimiters.closing)) return

  const content = math.slice(
    delimiters.opening.length,
    -delimiters.closing.length
  )
  const nodes = trimNodes(parseLatexFragment(content))
  if (nodes.length !== 1) return
  const environment = nodes[0]
  if (
    environment.kind !== 'environment' ||
    !NESTED_CELL_TABLE_ENVIRONMENTS.has(environment.name)
  ) {
    return
  }
  return flattenEnvironment(content, environment)
    .lines.map(line => `${delimiters.opening}${line}${delimiters.closing}`)
    .join(SEMANTIC_LINE_BREAK)
}

const flattenNodes = (source: string, nodes: LatexNode[]): string[] => {
  const rows: string[][] = [['']]
  const append = (value: string) => {
    const row = rows[rows.length - 1]
    row[row.length - 1] += value
  }

  for (const node of nodes) {
    if (node.kind === 'separator') {
      if (node.separator === 'cell') rows[rows.length - 1].push('')
      else rows.push([''])
      continue
    }
    if (node.kind === 'comment') continue
    if (node.kind === 'math') {
      append(flattenMathTable(source, node) ?? source.slice(node.from, node.to))
      continue
    }
    if (node.kind === 'environment') {
      if (NESTED_CELL_TABLE_ENVIRONMENTS.has(node.name)) {
        append(flattenEnvironment(source, node).lines.join(SEMANTIC_LINE_BREAK))
      } else {
        append(source.slice(node.from, node.to))
      }
      continue
    }
    if (node.kind === 'command') {
      if (TABLE_STRUCTURE_COMMANDS.has(node.name)) continue
      if (CONTENT_ARGUMENT_COMMANDS.has(node.name)) {
        const content = node.arguments.at(-1)
        if (content) {
          append(
            flattenNodes(source, content.children).join(SEMANTIC_LINE_BREAK)
          )
        }
        continue
      }
    }
    append(source.slice(node.from, node.to))
  }

  return rows
    .map(row => row.map(normalizeCell).filter(Boolean).join(' '))
    .filter(Boolean)
}

const flattenEnvironment = (
  source: string,
  environment: EnvironmentNode
): NestedCellTable => {
  const specification = tableSpecification(source, environment)
  const normalizedSpecification = specification
    ? tabularrayColumnSpecification(specification)
    : undefined
  return {
    alignment: normalizedSpecification
      ? readSingleColumnAlignment(normalizedSpecification)
      : undefined,
    lines: flattenNodes(source, bodyNodes(environment)),
  }
}

/** Converts a nested table-like layout container into editable cell lines. */
export const unwrapNestedCellTable = (
  source: string
): NestedCellTable | undefined => {
  const nodes = trimNodes(parseLatexFragment(source))
  if (nodes.length !== 1) return
  const root = nodes[0]
  if (root.kind === 'math') {
    const flattened = flattenMathTable(source, root)
    return flattened === undefined
      ? undefined
      : { lines: flattened.split(SEMANTIC_LINE_BREAK) }
  }
  if (
    root.kind === 'environment' &&
    NESTED_CELL_TABLE_ENVIRONMENTS.has(root.name)
  ) {
    return flattenEnvironment(source, root)
  }
}
