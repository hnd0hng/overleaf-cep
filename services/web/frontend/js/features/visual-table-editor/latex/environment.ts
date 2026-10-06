import type { TableEnvironment, TableWrapperEnvironment } from '../types'

export const TABLE_ENVIRONMENTS = new Set<TableEnvironment>([
  'tabular',
  'tabular*',
  'tabularx',
  'xltabular',
  'longtable',
])

export const TABLE_WRAPPER_ENVIRONMENTS = new Set<TableWrapperEnvironment>([
  'table',
  'table*',
  'sidewaystable',
  'sidewaystable*',
])

export const isTableEnvironment = (value: string): value is TableEnvironment =>
  TABLE_ENVIRONMENTS.has(value as TableEnvironment)

export const isTableWrapperEnvironment = (
  value: string
): value is Exclude<TableWrapperEnvironment, 'standalone'> =>
  TABLE_WRAPPER_ENVIRONMENTS.has(value as TableWrapperEnvironment)

export const environmentNeedsWidth = (environment: TableEnvironment) =>
  environment === 'tabular*' ||
  environment === 'tabularx' ||
  environment === 'xltabular'
