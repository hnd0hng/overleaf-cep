import type { HorizontalAlignment } from '../types'
import { parseLatexFragment } from './parser'
import { trimNodes } from './syntax-tree'

export type NestedCellTable = {
  alignment: HorizontalAlignment
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

const editableEscapeCommands = new Set([
  '&',
  '%',
  '$',
  '#',
  '_',
  '{',
  '}',
  'textasciitilde',
  'textasciicircum',
  'textbackslash',
])

const splitRows = (source: string) => {
  const nodes = parseLatexFragment(source)
  if (
    nodes.some(node => node.kind === 'separator' && node.separator === 'cell')
  ) {
    return
  }

  const rows: string[] = []
  let cursor = 0
  for (const node of nodes) {
    if (node.kind === 'command' && !editableEscapeCommands.has(node.name)) {
      return
    }
    if (node.kind !== 'separator' || node.separator !== 'row') continue
    rows.push(source.slice(cursor, node.from).trim())
    cursor = node.to
  }
  const trailing = source.slice(cursor).trim()
  if (trailing) rows.push(trailing)
  return rows.length && rows.every(row => row.length > 0) ? rows : undefined
}

/**
 * Converts a one-column nested tabular used as a line-breaking container into
 * editable lines. Multi-column or structurally rich nested tables stay opaque.
 */
export const unwrapNestedCellTable = (
  source: string
): NestedCellTable | undefined => {
  const nodes = trimNodes(parseLatexFragment(source))
  if (nodes.length !== 1) return
  const environment = nodes[0]
  if (environment.kind !== 'environment' || environment.name !== 'tabular') {
    return
  }

  const specification = environment.arguments.findLast(
    argument => !argument.optional
  )
  if (!specification) return
  const alignment = readSingleColumnAlignment(
    source.slice(specification.from + 1, specification.to - 1)
  )
  if (!alignment) return

  const lines = splitRows(
    source.slice(environment.beginEnd, environment.endStart)
  )
  return lines ? { alignment, lines } : undefined
}
