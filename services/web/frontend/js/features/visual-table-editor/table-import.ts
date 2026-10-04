import { detectDelimiter, parseDelimited } from './csv'
import { locateTableEnvironment, parseLatexTable } from './latex'
import { cellAt } from './model'
import {
  createTableModel,
  Diagnostic,
  TableEnvironment,
  TableModel,
} from './types'

export const MAX_IMPORT_CELLS = 100_000

export type CsvImportDelimiter = 'auto' | ',' | ';' | '\t'

export type TableImportResult = {
  model: TableModel
  rows: number
  columns: number
  diagnostics: Diagnostic[]
  unsafe: boolean
  metadata: {
    format: 'csv' | 'latex'
    delimiter?: string
    environment?: TableEnvironment
  }
}

const assertImportSize = (rows: number, columns: number) => {
  if (rows * columns > MAX_IMPORT_CELLS) {
    throw new Error(
      `The imported table has ${rows * columns} cells. The maximum supported size is ${MAX_IMPORT_CELLS}.`
    )
  }
}

const trimTrailingEmptyColumns = (matrix: string[][]) => {
  let columns = matrix.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0
  )
  while (columns > 0 && matrix.every(row => !(row[columns - 1] ?? '').trim())) {
    columns--
  }
  return matrix.map(row => row.slice(0, columns))
}

export const createModelFromMatrix = (matrix: string[][]) => {
  const rows = matrix.length
  const columns = matrix.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0
  )
  if (!rows || !columns) throw new Error('Enter at least one CSV cell.')
  assertImportSize(rows, columns)
  const model = createTableModel(rows, columns)
  matrix.forEach((row, rowIndex) =>
    row.forEach((text, columnIndex) => {
      const cell = cellAt(model, rowIndex, columnIndex)
      if (cell) cell.content = { text }
    })
  )
  return model
}

export const parseCsvImport = (
  source: string,
  delimiter: CsvImportDelimiter = 'auto'
): TableImportResult => {
  if (!source.trim()) throw new Error('Enter CSV text to import.')
  const resolvedDelimiter =
    delimiter === 'auto' ? detectDelimiter(source) : delimiter
  const matrix = trimTrailingEmptyColumns(
    parseDelimited(source, resolvedDelimiter)
  )
  const model = createModelFromMatrix(matrix)
  return {
    model,
    rows: model.rows.length,
    columns: model.columns.length,
    diagnostics: [],
    unsafe: false,
    metadata: {
      format: 'csv',
      delimiter: resolvedDelimiter,
    },
  }
}

const stripOuterComments = (source: string) =>
  source.replace(/(^|\n)\s*%[^\n]*(?=\n|$)/g, '$1').trim()

const validateCompleteLatexTable = (source: string) => {
  const normalized = stripOuterComments(source)
  if (!normalized) throw new Error('Enter LaTeX table code to import.')

  const location = locateTableEnvironment(normalized)
  const environment = location.environment
  const isStandalone =
    location.beginStart === 0 && location.endEnd === normalized.length
  const isTableWrapper =
    /^\\begin\{table\}(?:\[[^\]]*\])?/.test(normalized) &&
    normalized.endsWith('\\end{table}')

  if (!isStandalone && !isTableWrapper) {
    throw new Error(
      'Enter a complete tabular, tabularx, or longtable environment, optionally wrapped in a table environment.'
    )
  }
  return { normalized, environment }
}

export const detectTableImportFormat = (source: string): 'csv' | 'latex' => {
  try {
    validateCompleteLatexTable(source)
    return 'latex'
  } catch {
    return 'csv'
  }
}

export const parseLatexImport = (
  source: string,
  allowUnsafe = false
): TableImportResult => {
  const { normalized, environment } = validateCompleteLatexTable(source)
  const parsed = parseLatexTable(normalized, allowUnsafe)
  if (!parsed.unsafe || allowUnsafe) {
    assertImportSize(parsed.model.rows.length, parsed.model.columns.length)
  }
  return {
    model: parsed.model,
    rows: parsed.model.rows.length,
    columns: parsed.model.columns.length,
    diagnostics: parsed.diagnostics,
    unsafe: parsed.unsafe,
    metadata: { format: 'latex', environment },
  }
}
