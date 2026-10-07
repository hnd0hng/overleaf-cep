import { generateSHA1Hash } from '@/shared/utils/sha1'
import type {
  LatexSourceLayout,
  TableModel,
  TableWrapperEnvironment,
} from '../types'

const semanticModel = (model: TableModel) => ({
  schemaVersion: model.schemaVersion,
  rows: model.rows,
  columns: model.columns,
  cells: model.cells,
  options: model.options,
  unsafeImport: model.unsafeImport,
})

export const latexStructureFingerprint = (model: TableModel) =>
  generateSHA1Hash(
    JSON.stringify({
      rows: model.rows.map(row => ({
        id: row.id,
        longtableSection: row.longtableSection,
        backgroundColor: row.backgroundColor,
      })),
      columns: model.columns,
      cells: Object.values(model.cells)
        .map(cell => ({
          id: cell.id,
          row: cell.row,
          column: cell.column,
          rowSpan: cell.rowSpan,
          columnSpan: cell.columnSpan,
          horizontalAlignment: cell.horizontalAlignment,
          verticalAlignment: cell.verticalAlignment,
          backgroundColor: cell.backgroundColor,
          latexPresentation: cell.latexPresentation,
          borders: cell.borders,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      environment: model.options.environment,
      style: model.options.style,
    })
  )

export const modelFingerprint = (model: TableModel) =>
  generateSHA1Hash(JSON.stringify(semanticModel(model)))

export const attachLatexOrigin = (
  model: TableModel,
  source: string,
  wrapper: TableWrapperEnvironment,
  layout?: LatexSourceLayout
) => {
  model.latexOrigin = {
    source,
    wrapper,
    modelFingerprint: modelFingerprint(model),
    layout,
  }
}

export const unchangedLatexSource = (model: TableModel) => {
  const origin = model.latexOrigin
  if (!origin || modelFingerprint(model) !== origin.modelFingerprint) return
  return origin.source
}
