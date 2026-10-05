import { getCells } from '../../model'
import type { TableModel } from '../../types'

type Interval = [number, number]

const mergeIntervals = (intervals: Interval[]) => {
  const merged: Interval[] = []
  for (const [from, to] of intervals.sort(
    (left, right) => left[0] - right[0]
  )) {
    const previous = merged.at(-1)
    if (previous && from <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], to)
    } else {
      merged.push([from, to])
    }
  }
  return merged
}

const addInterval = (
  boundaries: Map<number, Interval[]>,
  boundary: number,
  interval: Interval
) => {
  const intervals = boundaries.get(boundary) ?? []
  intervals.push(interval)
  boundaries.set(boundary, intervals)
}

export const analyzeBoundaryRules = (model: TableModel) => {
  const boundaries = new Map<number, Interval[]>()
  for (const cell of getCells(model)) {
    const interval: Interval = [cell.column + 1, cell.column + cell.columnSpan]
    if (cell.borders.top !== 'none') {
      addInterval(boundaries, cell.row, interval)
    }
    if (cell.borders.bottom !== 'none') {
      addInterval(boundaries, cell.row + cell.rowSpan, interval)
    }
  }
  for (const [boundary, intervals] of boundaries) {
    boundaries.set(boundary, mergeIntervals(intervals))
  }

  return (boundary: number) => {
    if (model.options.style === 'booktabs') {
      if (boundary === 0) return '\\toprule'
      if (boundary === model.rows.length) return '\\bottomrule'
      if (boundary === 1) return '\\midrule'
    }

    const intervals = boundaries.get(boundary) ?? []
    if (!intervals.length) return ''
    if (
      intervals.length === 1 &&
      intervals[0][0] === 1 &&
      intervals[0][1] === model.columns.length
    ) {
      return model.options.style === 'booktabs' ? '\\midrule' : '\\hline'
    }
    const command =
      model.options.style === 'booktabs' ? '\\cmidrule' : '\\cline'
    return intervals.map(([from, to]) => `${command}{${from}-${to}}`).join(' ')
  }
}
