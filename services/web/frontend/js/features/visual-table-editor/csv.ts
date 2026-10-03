import { parse } from 'csv-parse/browser/esm/sync'
import { stringify } from 'csv-stringify/browser/esm/sync'
import { cellAt } from './model'
import { TableModel } from './types'

export const parseDelimited = (
  value: string,
  delimiter: string | RegExp = ','
): string[][] => {
  if (delimiter instanceof RegExp) {
    return value.split(/\r?\n/).map(line => line.trim().split(delimiter))
  }
  return parse(value, {
    bom: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
  }) as string[][]
}

export const detectDelimiter = (value: string) => {
  const firstLine = value.split(/\r?\n/, 1)[0]
  const candidates = ['\t', ',', ';']
  return candidates.sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length
  )[0]
}

export const parseSpreadsheetClipboard = (value: string) =>
  parseDelimited(value, detectDelimiter(value))

export const exportCsv = (model: TableModel, delimiter = ',') => {
  const data: string[][] = []
  for (let row = 0; row < model.rows.length; row++) {
    const values: string[] = []
    for (let column = 0; column < model.columns.length; column++) {
      const cell = cellAt(model, row, column)!
      values.push(
        cell.row === row && cell.column === column
          ? cell.content.text || cell.content.rawLatex || ''
          : ''
      )
    }
    data.push(values)
  }
  return stringify(data, { delimiter })
}

export const parseHtmlTable = (html: string) => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const table = document.querySelector('table')
  if (!table) return null
  return [...table.rows].map(row =>
    [...row.cells].map(cell => ({
      text: cell.textContent ?? '',
      bold:
        Boolean(cell.querySelector('b,strong')) ||
        getComputedStyle(cell).fontWeight === 'bold',
      italic:
        Boolean(cell.querySelector('i,em')) ||
        getComputedStyle(cell).fontStyle === 'italic',
      color: cell.style.color || undefined,
      backgroundColor: cell.style.backgroundColor || undefined,
      horizontalAlignment:
        cell.style.textAlign === 'right'
          ? ('right' as const)
          : cell.style.textAlign === 'center'
            ? ('center' as const)
            : ('left' as const),
    }))
  )
}
