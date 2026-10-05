import { parseLatexFragment } from './parser'
import type { LatexNode } from './syntax-tree'

export type RuleInterval = readonly [number, number]

const argumentText = (source: string, node: LatexNode) => {
  if (node.kind !== 'command') return ''
  const argument = node.arguments.at(-1)
  return argument ? source.slice(argument.from + 1, argument.to - 1) : ''
}

const intervalForCommand = (
  source: string,
  node: Extract<LatexNode, { kind: 'command' }>,
  columnCount: number
): RuleInterval[] => {
  if (['hline', 'toprule', 'midrule', 'bottomrule'].includes(node.name)) {
    return [[0, columnCount - 1]]
  }
  if (['cline', 'cmidrule', 'cdashline'].includes(node.name)) {
    const match = argumentText(source, node).match(/(\d+)\s*-\s*(\d+)/)
    return match ? [[Number(match[1]) - 1, Number(match[2]) - 1]] : []
  }
  if (node.name === 'hhline') {
    const intervals: RuleInterval[] = []
    let column = 0
    for (const character of argumentText(source, node)) {
      if (character === '-' || character === '=') {
        intervals.push([column, column])
        column++
      } else if (character === '~') {
        column++
      }
    }
    return intervals
  }
  return []
}

const ruleCommands = new Set([
  'hline',
  'toprule',
  'midrule',
  'bottomrule',
  'cline',
  'cmidrule',
  'cdashline',
  'hhline',
  'specialrule',
])

const structuralCommands = new Set([
  ...ruleCommands,
  'addlinespace',
  'noalign',
  'rowcolor',
  'endfirsthead',
  'endhead',
  'endfoot',
  'endlastfoot',
])

export const extractRowStructure = (source: string, columnCount: number) => {
  const nodes = parseLatexFragment(source)
  const rules: RuleInterval[] = []
  let content = ''
  let cursor = 0
  for (const node of nodes) {
    if (node.kind !== 'command' || !structuralCommands.has(node.name)) continue
    content += source.slice(cursor, node.from)
    cursor = node.to
    if (ruleCommands.has(node.name)) {
      rules.push(...intervalForCommand(source, node, columnCount))
    }
  }
  content += source.slice(cursor)
  return { content, rules }
}
