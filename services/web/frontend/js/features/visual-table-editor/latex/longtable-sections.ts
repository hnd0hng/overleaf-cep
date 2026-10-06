import type { LongtableSection, TableModel } from '../types'
import { parseLatexFragment } from './parser'

export const LONGTABLE_SECTION_ORDER: LongtableSection[] = [
  'firstHead',
  'head',
  'foot',
  'lastFoot',
  'body',
]

export const LONGTABLE_SECTION_LABELS: Record<LongtableSection, string> = {
  firstHead: 'First-page header',
  head: 'Repeated header',
  foot: 'Page footer',
  lastFoot: 'Last-page footer',
  body: 'Table body',
}

const markerSection: Record<string, LongtableSection> = {
  endfirsthead: 'firstHead',
  endhead: 'head',
  endfoot: 'foot',
  endlastfoot: 'lastFoot',
}

const nextSection: Record<string, LongtableSection> = {
  endfirsthead: 'head',
  endhead: 'foot',
  endfoot: 'lastFoot',
  endlastfoot: 'body',
}

export type LongtableSourceSection = {
  kind: LongtableSection
  source: string
  from: number
  to: number
  marker?: string
}

export const splitLongtableSections = (source: string) => {
  const nodes = parseLatexFragment(source)
  const markers = nodes.filter(
    node => node.kind === 'command' && node.name in markerSection
  )
  const diagnostics: string[] = []
  let previousOrder = -1
  const seen = new Set<string>()
  for (const marker of markers) {
    if (marker.kind !== 'command') continue
    const order = LONGTABLE_SECTION_ORDER.indexOf(markerSection[marker.name])
    if (seen.has(marker.name) || order <= previousOrder) {
      diagnostics.push(
        `Longtable marker \\${marker.name} is duplicated or out of order.`
      )
    }
    seen.add(marker.name)
    previousOrder = order
  }

  if (!markers.length) {
    return {
      sections: [{ kind: 'body' as const, source, from: 0, to: source.length }],
      diagnostics,
    }
  }

  const sections: LongtableSourceSection[] = []
  let cursor = 0
  for (const marker of markers) {
    if (marker.kind !== 'command') continue
    sections.push({
      kind: markerSection[marker.name],
      source: source.slice(cursor, marker.from),
      from: cursor,
      to: marker.from,
      marker: source.slice(marker.from, marker.to),
    })
    cursor = marker.to
  }
  const lastMarker = markers.at(-1)
  const trailingKind =
    lastMarker?.kind === 'command' ? nextSection[lastMarker.name] : 'body'
  sections.push({
    kind: trailingKind,
    source: source.slice(cursor),
    from: cursor,
    to: source.length,
  })
  return { sections, diagnostics }
}

export const sectionForInsertion = (model: TableModel, index: number) => {
  if (model.options.environment !== 'longtable') return undefined
  return (
    model.rows[index]?.longtableSection ??
    model.rows[index - 1]?.longtableSection ??
    'body'
  )
}

export const selectionCrossesLongtableSection = (
  model: TableModel,
  from: number,
  to: number
) => {
  if (model.options.environment !== 'longtable') return false
  const sections = new Set(
    model.rows.slice(from, to + 1).map(row => row.longtableSection ?? 'body')
  )
  return sections.size > 1
}

export const rowMoveCrossesLongtableSection = (
  model: TableModel,
  from: number,
  to: number,
  insertionIndex: number
) => {
  if (model.options.environment !== 'longtable') return false
  if (selectionCrossesLongtableSection(model, from, to)) return true
  const section = model.rows[from]?.longtableSection ?? 'body'
  const sectionRows = model.rows
    .map((row, index) => ({ index, section: row.longtableSection ?? 'body' }))
    .filter(row => row.section === section)
  if (!sectionRows.length) return true
  const minimum = sectionRows[0].index
  const maximum = sectionRows.at(-1)!.index + 1
  return insertionIndex < minimum || insertionIndex > maximum
}
