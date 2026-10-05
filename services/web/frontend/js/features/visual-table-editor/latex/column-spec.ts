import type { Diagnostic, HorizontalAlignment, TableColumn } from '../types'

type ColumnParseResult = {
  columns: TableColumn[]
  verticalBoundaries: Set<number>
  diagnostics: Diagnostic[]
  unsafe: boolean
}

const readGroup = (source: string, start: number) => {
  if (source[start] !== '{') throw new Error('Expected { in column definition.')
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === '\\') {
      index++
      continue
    }
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) {
      return { value: source.slice(start + 1, index), end: index + 1 }
    }
  }
  throw new Error('Unclosed group in column definition.')
}

const alignmentFromModifier = (
  modifier: string
): HorizontalAlignment | undefined => {
  if (/\\raggedright\b/.test(modifier)) return 'left'
  if (/\\raggedleft\b/.test(modifier)) return 'right'
  if (/\\centering\b/.test(modifier)) return 'center'
}

export const parseColumnSpecification = (
  specification: string
): ColumnParseResult => {
  const columns: TableColumn[] = []
  const verticalBoundaries = new Set<number>()
  const diagnostics: Diagnostic[] = []
  let unsafe = false
  let pendingAlignment: HorizontalAlignment | undefined

  const addColumn = (
    alignment: HorizontalAlignment,
    width: TableColumn['width'] = { mode: 'auto' },
    verticalAlignment: TableColumn['verticalAlignment'] = 'top'
  ) => {
    columns.push({
      id: `column-${columns.length}`,
      alignment: pendingAlignment ?? alignment,
      verticalAlignment,
      width,
    })
    pendingAlignment = undefined
  }

  const parseRange = (source: string) => {
    for (let index = 0; index < source.length; index++) {
      const character = source[index]
      if (/\s/.test(character)) continue
      if (character === '|' || character === ':') {
        verticalBoundaries.add(columns.length)
        if (character === ':') {
          unsafe = true
          diagnostics.push({
            severity: 'warning',
            message: 'Dashed vertical rules are shown as solid rules.',
          })
        }
        continue
      }
      if (character === '*') {
        while (/\s/.test(source[index + 1] ?? '')) index++
        const count = readGroup(source, index + 1)
        index = count.end - 1
        while (/\s/.test(source[index + 1] ?? '')) index++
        const repeated = readGroup(source, index + 1)
        index = repeated.end - 1
        const repeatCount = Number.parseInt(count.value.trim(), 10)
        if (
          !Number.isInteger(repeatCount) ||
          repeatCount < 0 ||
          repeatCount > 1000
        ) {
          throw new Error(`Unsupported repeated column count: ${count.value}`)
        }
        for (let repeat = 0; repeat < repeatCount; repeat++) {
          parseRange(repeated.value)
        }
        continue
      }
      if ('><@!'.includes(character)) {
        while (/\s/.test(source[index + 1] ?? '')) index++
        const argument = readGroup(source, index + 1)
        if (character === '>') {
          pendingAlignment =
            alignmentFromModifier(argument.value) ?? pendingAlignment
        } else if (character === '@' || character === '!') {
          unsafe = true
          diagnostics.push({
            severity: 'warning',
            message: `Column inter-material ${character}{...} is preserved only until the table structure is edited.`,
          })
        }
        index = argument.end - 1
        continue
      }
      if ('lcr'.includes(character)) {
        addColumn(
          character === 'l' ? 'left' : character === 'r' ? 'right' : 'center'
        )
        continue
      }
      if (character === 'X') {
        addColumn('left', { mode: 'flex' })
        continue
      }
      if ('pmb'.includes(character)) {
        while (/\s/.test(source[index + 1] ?? '')) index++
        const width = readGroup(source, index + 1)
        const match = width.value
          .trim()
          .match(/^([0-9]*\.?[0-9]+)\s*([a-zA-Z]+)$/)
        if (!match) {
          unsafe = true
          diagnostics.push({
            severity: 'warning',
            message: `Column width expression ${width.value} cannot be edited visually.`,
          })
          addColumn('left')
        } else {
          addColumn(
            'left',
            { mode: 'fixed', value: Number(match[1]), unit: match[2] },
            character === 'm' ? 'middle' : character === 'b' ? 'bottom' : 'top'
          )
        }
        index = width.end - 1
        continue
      }
      if (character === 'w' || character === 'W') {
        const alignment = readGroup(source, index + 1)
        const width = readGroup(source, alignment.end)
        const match = width.value
          .trim()
          .match(/^([0-9]*\.?[0-9]+)\s*([a-zA-Z]+)$/)
        addColumn(
          alignment.value.trim() === 'r'
            ? 'right'
            : alignment.value.trim() === 'c'
              ? 'center'
              : 'left',
          match
            ? { mode: 'fixed', value: Number(match[1]), unit: match[2] }
            : { mode: 'auto' }
        )
        if (!match) unsafe = true
        index = width.end - 1
        continue
      }
      if (character === 'S' || character === 'D' || /[A-Z]/.test(character)) {
        addColumn('center')
        unsafe = true
        diagnostics.push({
          severity: 'warning',
          message: `Column type ${character} is approximated as a centered column.`,
        })
        if (character === 'D') {
          for (let argumentIndex = 0; argumentIndex < 3; argumentIndex++) {
            while (/\s/.test(source[index + 1] ?? '')) index++
            if (source[index + 1] === '{') {
              const argument = readGroup(source, index + 1)
              index = argument.end - 1
            }
          }
        }
        continue
      }
      throw new Error(`Unsupported column type: ${character}`)
    }
  }

  parseRange(specification)
  if (!columns.length) throw new Error('No supported columns found')
  return { columns, verticalBoundaries, diagnostics, unsafe }
}
