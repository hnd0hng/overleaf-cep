import type {
  LatexLongtableSectionLayout,
  LongtableSection,
  TableEnvironment,
} from '../types'
import { environmentNeedsWidth } from './environment'
import { splitLongtableSections } from './longtable-sections'
import { parseLatexFragment } from './parser'
import { extractRowStructure } from './row-extractor'
import type { MetadataSpan } from './source-layout'

type EnvironmentLocation = {
  beginEnd: number
  endStart: number
}

const skipWhitespace = (source: string, start: number) => {
  let cursor = start
  while (/\s/.test(source[cursor] ?? '')) cursor++
  return cursor
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
    if (character === close && --depth === 0) {
      return {
        value: source.slice(start + 1, index),
        end: index + 1,
      }
    }
  }
  throw new Error(`Unclosed ${open}`)
}

export const readTablePreamble = (
  source: string,
  location: EnvironmentLocation,
  environment: TableEnvironment
) => {
  let cursor = skipWhitespace(source, location.beginEnd)
  let targetWidth = '\\textwidth'
  let environmentPosition: string | undefined

  if (environment === 'tabular*') {
    const width = readBalanced(source, cursor)
    targetWidth = width.value
    cursor = skipWhitespace(source, width.end)
    if (source[cursor] === '[') {
      const position = readBalanced(source, cursor, '[', ']')
      environmentPosition = position.value
      cursor = skipWhitespace(source, position.end)
    }
  } else {
    if (environment === 'tabular' || environment === 'longtable') {
      if (source[cursor] === '[') {
        const position = readBalanced(source, cursor, '[', ']')
        environmentPosition = position.value
        cursor = skipWhitespace(source, position.end)
      }
    }
    if (environmentNeedsWidth(environment)) {
      const width = readBalanced(source, cursor)
      targetWidth = width.value
      cursor = skipWhitespace(source, width.end)
    }
  }

  const specification = readBalanced(source, cursor)
  return {
    body: source.slice(specification.end, location.endStart),
    bodyStart: specification.end,
    environmentPosition,
    specification: specification.value,
    targetWidth,
  }
}

type RowChunk = {
  from: number
  to: number
  separator: string
  source: string
}

const splitRows = (source: string): RowChunk[] => {
  const separators = parseLatexFragment(source).filter(
    node => node.kind === 'separator' && node.separator === 'row'
  )
  const chunks: RowChunk[] = []
  let cursor = 0
  for (const separator of separators) {
    chunks.push({
      from: cursor,
      to: separator.from,
      separator: source.slice(separator.from, separator.to),
      source: source.slice(cursor, separator.from),
    })
    cursor = separator.to
  }
  chunks.push({
    from: cursor,
    to: source.length,
    separator: '',
    source: source.slice(cursor),
  })
  return chunks
}

const withoutMetadata = (
  source: string,
  absoluteStart: number,
  metadata: MetadataSpan[]
) => {
  let result = source
  const matches = metadata
    .filter(
      command =>
        command.from >= absoluteStart &&
        command.to <= absoluteStart + source.length
    )
    .sort((left, right) => right.from - left.from)
  for (const command of matches) {
    result =
      result.slice(0, command.from - absoluteStart) +
      result.slice(command.to - absoluteStart)
  }
  return { clean: result, matches: matches.reverse() }
}

type PendingFragment = {
  beforeRowIndex?: number
  template: string
}

export const parseTableBody = (
  body: string,
  bodyStart: number,
  environment: TableEnvironment,
  columnCount: number,
  metadata: MetadataSpan[]
) => {
  const rawRows: string[] = []
  const rowSections: LongtableSection[] = []
  const rulesAtBoundary = new Map<number, Array<readonly [number, number]>>()
  const sectionLayouts: Array<
    LatexLongtableSectionLayout & { pending: PendingFragment[] }
  > = []
  const split =
    environment === 'longtable'
      ? splitLongtableSections(body)
      : {
          sections: [
            {
              kind: 'body' as const,
              source: body,
              from: 0,
              to: body.length,
            },
          ],
          diagnostics: [] as string[],
        }

  for (const section of split.sections) {
    const layout: LatexLongtableSectionLayout & {
      pending: PendingFragment[]
    } = {
      kind: section.kind,
      marker: section.marker,
      prefixTemplate: '',
      suffixTemplate: '',
      fragments: [],
      pending: [],
    }
    for (const chunk of splitRows(section.source)) {
      const absoluteStart = bodyStart + section.from + chunk.from
      const extracted = withoutMetadata(chunk.source, absoluteStart, metadata)
      const { content, rules } = extractRowStructure(
        extracted.clean,
        columnCount
      )
      const boundary = rawRows.length
      if (rules.length) {
        rulesAtBoundary.set(boundary, [
          ...(rulesAtBoundary.get(boundary) ?? []),
          ...rules,
        ])
      }
      const template = extracted.matches.map(command => command.token).join('')
      if (content.trim()) {
        if (template) {
          layout.pending.push({
            beforeRowIndex: rawRows.length,
            template,
          })
        }
        rawRows.push(content)
        rowSections.push(section.kind)
      } else if (template) {
        layout.pending.push({
          beforeRowIndex: chunk.separator ? rawRows.length : undefined,
          template: `${template}${chunk.separator}`,
        })
      }
    }
    sectionLayouts.push(layout)
  }

  return {
    diagnostics: split.diagnostics,
    rawRows,
    rowSections,
    rulesAtBoundary,
    sectionLayouts,
  }
}
