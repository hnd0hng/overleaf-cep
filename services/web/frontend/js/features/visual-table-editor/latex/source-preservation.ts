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
