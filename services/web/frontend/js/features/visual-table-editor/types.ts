export type TableEnvironment =
  | 'tabular'
  | 'tabular*'
  | 'tabularx'
  | 'xltabular'
  | 'longtable'
export type TableWrapperEnvironment =
  | 'standalone'
  | 'table'
  | 'table*'
  | 'sidewaystable'
  | 'sidewaystable*'
export type LongtableSection =
  | 'firstHead'
  | 'head'
  | 'foot'
  | 'lastFoot'
  | 'body'
export type HorizontalAlignment = 'left' | 'center' | 'right'
export type VerticalAlignment = 'top' | 'middle' | 'bottom'
export type BorderStyle =
  | 'none'
  | 'solid'
  | 'booktabs-top'
  | 'booktabs-mid'
  | 'booktabs-bottom'

export type TextStyle = {
  bold?: boolean
  italic?: boolean
  color?: string
}

export type CellContent = {
  /** Literal user text. It is escaped by the generator. */
  text: string
  /** Imported LaTeX that could not be represented as literal text. */
  rawLatex?: string
  style?: TextStyle
}

export type CellBorders = {
  top: BorderStyle
  right: BorderStyle
  bottom: BorderStyle
  left: BorderStyle
}

export type TableCell = {
  id: string
  row: number
  column: number
  rowSpan: number
  columnSpan: number
  content: CellContent
  horizontalAlignment?: HorizontalAlignment
  verticalAlignment?: VerticalAlignment
  backgroundColor?: string
  borders: CellBorders
  numberFormat?: {
    precision?: number
    thousandsSeparator?: boolean
    decimalSeparator?: '.' | ','
  }
}

export type TableColumn = {
  id: string
  alignment: HorizontalAlignment
  verticalAlignment: VerticalAlignment
  width:
    | { mode: 'auto' }
    | { mode: 'fixed'; value: number; unit: string }
    | { mode: 'flex' }
}

export type TableRow = {
  id: string
  repeatOnNewPage?: boolean
  longtableSection?: LongtableSection
}

export type TableOptions = {
  environment: TableEnvironment
  targetWidth: string
  style: 'default' | 'booktabs'
  caption: string
  label: string
  centered: boolean
  scale: 'none' | 'textwidth' | 'columnwidth'
  placement: string
  environmentPosition?: string
}

export type LatexMetadataCommand = {
  token: string
  kind: 'caption' | 'label'
  raw: string
  value: string
  primary: boolean
  star?: boolean
  optionalArgument?: string
}

export type LatexAnchoredFragment = {
  beforeRowId?: string
  template: string
}

export type LatexLongtableSectionLayout = {
  kind: LongtableSection
  marker?: string
  prefixTemplate: string
  suffixTemplate: string
  fragments?: LatexAnchoredFragment[]
}

export type LatexSourceLayout = {
  wrapper: TableWrapperEnvironment
  beforeGridTemplate: string
  afterGridTemplate: string
  metadata: LatexMetadataCommand[]
  gridEnvironment: TableEnvironment
  sections?: LatexLongtableSectionLayout[]
}

export type TableModel = {
  schemaVersion: 1
  rows: TableRow[]
  columns: TableColumn[]
  cells: Record<string, TableCell>
  options: TableOptions
  unsafeImport?: boolean
  /** Original LaTeX is retained only while the imported model is unchanged. */
  latexOrigin?: {
    source: string
    wrapper: TableWrapperEnvironment
    modelFingerprint: string
    layout?: LatexSourceLayout
  }
  diagnostics: Diagnostic[]
}

export type CellPoint = { row: number; column: number }
export type CellSelection = { from: CellPoint; to: CellPoint }

export type Diagnostic = {
  severity: 'warning' | 'error'
  message: string
  from?: number
  to?: number
}

export type SourceAnchor = {
  projectId: string
  documentId: string
  mode: 'new' | 'edit'
  from: number
  to: number
  originalSource: string
  fingerprint: string
  beforeContext: string
  afterContext: string
}

export type EditorSession = {
  id: string
  anchor: SourceAnchor
  model: TableModel
  selection: CellSelection
  generatedLatex: string
}

export const emptyBorders = (): CellBorders => ({
  top: 'none',
  right: 'none',
  bottom: 'none',
  left: 'none',
})

let sequence = 0
export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`

export const createTableModel = (rowCount = 3, columnCount = 3): TableModel => {
  const rows = Array.from({ length: rowCount }, () => ({
    id: createId('row'),
  }))
  const columns: TableColumn[] = Array.from({ length: columnCount }, () => ({
    id: createId('column'),
    alignment: 'center',
    verticalAlignment: 'top',
    width: { mode: 'auto' },
  }))
  const cells: Record<string, TableCell> = {}
  for (let row = 0; row < rowCount; row++) {
    for (let column = 0; column < columnCount; column++) {
      const cell: TableCell = {
        id: createId('cell'),
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        content: { text: '' },
        borders: {
          top: 'solid',
          right: 'solid',
          bottom: 'solid',
          left: 'solid',
        },
      }
      cells[cell.id] = cell
    }
  }
  return {
    schemaVersion: 1,
    rows,
    columns,
    cells,
    options: {
      environment: 'tabular',
      targetWidth: '\\textwidth',
      style: 'default',
      caption: '',
      label: '',
      centered: true,
      scale: 'none',
      placement: 'htbp',
    },
    diagnostics: [],
  }
}
