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
  | 'double'
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
  latexPresentation?: {
    multiline: 'makecell' | 'shortstack' | 'flattened-table'
    alignment?: HorizontalAlignment
  }
  borders: CellBorders
}

export type TableColumn = {
  id: string
  alignment: HorizontalAlignment
  /** Fixed-width columns only: false preserves native p/m/b justification. */
  alignmentExplicit?: boolean
  verticalAlignment: VerticalAlignment
  backgroundColor?: string
  width:
    | { mode: 'auto' }
    | { mode: 'fixed'; value: number; unit: string }
    | { mode: 'flex' }
}

export type TableDirective = {
  kind:
    | 'centering'
    | 'caption'
    | 'label'
    | 'tabcolsep'
    | 'arraystretch'
    | 'font-size'
    | 'rowcolors'
  position: 'before-grid' | 'after-grid'
  order: number
  value?: string
  arguments?: string[]
  scoped?: boolean
}

export type TableRow = {
  id: string
  repeatOnNewPage?: boolean
  longtableSection?: LongtableSection
  backgroundColor?: string
}

export type TableOptions = {
  wrapper: TableWrapperEnvironment
  environment: TableEnvironment
  targetWidth: string
  style: 'default' | 'booktabs'
  caption: string
  /** Imported captions containing LaTeX are emitted without text escaping. */
  captionIsLatex?: boolean
  label: string
  centered: boolean
  scale: 'none' | 'textwidth' | 'columnwidth'
  placement: string
  environmentPosition?: string
  directives?: TableDirective[]
  /** Supported longtable section terminators, including empty sections. */
  longtableMarkers?: string[]
  /** Supported rules anchored to longtable section boundaries. */
  longtableSectionRules?: Partial<
    Record<LongtableSection, { prefix: string[]; suffix: string[] }>
  >
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
  structural?: boolean
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
  columnSpecification?: string
  structureFingerprint?: string
  fragments?: LatexAnchoredFragment[]
  sections?: LatexLongtableSectionLayout[]
}

export type TableModel = {
  schemaVersion: 1
  rows: TableRow[]
  columns: TableColumn[]
  /** Vertical rules at the left edge, between columns, and at the right edge. */
  columnBoundaries: BorderStyle[]
  cells: Record<string, TableCell>
  options: TableOptions
  unsafeImport?: boolean
  /** Legacy draft compatibility only; canonical import/generation never reads or writes it. */
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
      wrapper: 'table',
      environment: 'tabular',
      targetWidth: '\\textwidth',
      style: 'default',
      caption: '',
      label: '',
      centered: true,
      scale: 'none',
      placement: 'htbp',
      directives: [{ kind: 'centering', position: 'before-grid', order: 0 }],
    },
    columnBoundaries: Array.from(
      { length: columnCount + 1 },
      () => 'solid' as const
    ),
    diagnostics: [],
  }
}
