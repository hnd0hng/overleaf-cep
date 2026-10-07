import type {
  BorderStyle,
  Diagnostic,
  HorizontalAlignment,
  TableColumn,
} from '../types'

type ColumnParseResult = {
  columns: TableColumn[]
  verticalBoundaries: BorderStyle[]
  diagnostics: Diagnostic[]
  unsafe: boolean
}

const readDelimitedGroup = (
  source: string,
  start: number,
  opening: '{' | '[' = '{'
) => {
  const closing = opening === '{' ? '}' : ']'
  if (source[start] !== opening) {
    throw new Error(`Expected ${opening} in column definition.`)
  }
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === '\\') {
      index++
      continue
    }
    if (source[index] === opening) depth++
    else if (source[index] === closing && --depth === 0) {
      return { value: source.slice(start + 1, index), end: index + 1 }
    }
  }
  throw new Error(`Unclosed ${opening} in column definition.`)
}

const readGroup = (source: string, start: number) =>
  readDelimitedGroup(source, start)

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
  const verticalBoundaries: BorderStyle[] = []
  const diagnostics: Diagnostic[] = []
  let unsafe = false
  let pendingAlignment: HorizontalAlignment | undefined
  let pendingBackgroundColor: string | undefined

  const addColumn = (
    alignment: HorizontalAlignment,
    width: TableColumn['width'] = { mode: 'auto' },
    verticalAlignment: TableColumn['verticalAlignment'] = 'top'
  ) => {
    columns.push({
      id: `column-${columns.length}`,
      alignment: pendingAlignment ?? alignment,
      alignmentExplicit:
        width.mode === 'fixed' ? pendingAlignment !== undefined : undefined,
      verticalAlignment,
      backgroundColor: pendingBackgroundColor,
      width,
    })
    pendingAlignment = undefined
    pendingBackgroundColor = undefined
  }

  const parseRange = (source: string) => {
    for (let index = 0; index < source.length; index++) {
      const character = source[index]
      if (/\s/.test(character)) continue
      if (character === '|' || character === ':') {
        const boundary = columns.length
        verticalBoundaries[boundary] =
          character === '|' && verticalBoundaries[boundary] === 'solid'
            ? 'double'
            : 'solid'
        if (character === ':') {
          unsafe = true
          diagnostics.push({
            severity: 'warning',
            message: 'Dashed vertical rules are converted to solid rules.',
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
          pendingBackgroundColor =
            argument.value.match(/\\columncolor\s*\{([^{}]+)\}/)?.[1] ??
            pendingBackgroundColor
        } else if (character === '@' || character === '!') {
          unsafe = true
          diagnostics.push({
            severity: 'warning',
            message: `Column inter-material ${character}{...} is not supported and will be removed.`,
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
        if (match) columns.at(-1)!.alignmentExplicit = true
        if (!match) unsafe = true
        index = width.end - 1
        continue
      }
      if (/[A-Z]/.test(character)) {
        const customAlignment =
          character === 'L' ? 'left' : character === 'R' ? 'right' : 'center'
        let customWidth: TableColumn['width'] = { mode: 'auto' }
        let argumentCount = character === 'D' ? 3 : Number.POSITIVE_INFINITY
        while (argumentCount > 0) {
          let cursor = index + 1
          while (/\s/.test(source[cursor] ?? '')) cursor++
          const opening = source[cursor]
          if (opening !== '{' && opening !== '[') break
          const argument = readDelimitedGroup(source, cursor, opening)
          if ('LCR'.includes(character) && opening === '{') {
            const width = argument.value
              .trim()
              .match(/^([0-9]*\.?[0-9]+)\s*([a-zA-Z]+)$/)
            if (width) {
              customWidth = {
                mode: 'fixed',
                value: Number(width[1]),
                unit: width[2],
              }
            }
          }
          index = argument.end - 1
          argumentCount--
        }
        addColumn(customAlignment, customWidth)
        if (customWidth.mode === 'fixed') {
          columns.at(-1)!.alignmentExplicit = true
        }
        unsafe = true
        diagnostics.push({
          severity: 'warning',
          message: `Column type ${character} is approximated using a supported column definition.`,
        })
        continue
      }
      throw new Error(`Unsupported column type: ${character}`)
    }
  }

  parseRange(specification)
  if (!columns.length) throw new Error('No supported columns found')
  const normalizedBoundaries = Array.from(
    { length: columns.length + 1 },
    (_, index) => verticalBoundaries[index] ?? 'none'
  )
  return {
    columns,
    verticalBoundaries: normalizedBoundaries,
    diagnostics,
    unsafe,
  }
}
