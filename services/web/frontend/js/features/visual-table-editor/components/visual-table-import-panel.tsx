import { useMemo, useState } from 'react'
import { Alert } from 'react-bootstrap'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import { cellAt } from '../model'
import {
  CsvImportDelimiter,
  detectTableImportFormat,
  parseCsvImport,
  parseLatexImport,
  TableImportResult,
} from '../table-import'
import { TableModel } from '../types'
import VisualTableConfirmationDialog from './visual-table-confirmation-dialog'

export type TableImportMode = 'csv' | 'latex'

type Props = {
  onCancel: () => void
  onImport: (model: TableModel) => void
  themed?: boolean
}

const delimiterLabel = (delimiter?: string) => {
  if (delimiter === '\t') return 'Tab'
  if (delimiter === ';') return 'Semicolon'
  return 'Comma'
}

export default function VisualTableImportPanel({
  onCancel,
  onImport,
  themed = false,
}: Props) {
  const [source, setSource] = useState('')
  const [mode, setMode] = useState<TableImportMode>('csv')
  const [modeSelectedManually, setModeSelectedManually] = useState(false)
  const [delimiter, setDelimiter] = useState<CsvImportDelimiter>('auto')
  const [allowUnsafe, setAllowUnsafe] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)

  const parsed = useMemo<{
    result: TableImportResult | null
    error: string | null
  }>(() => {
    if (!source) return { result: null, error: null }
    try {
      return {
        result:
          mode === 'csv'
            ? parseCsvImport(source, delimiter)
            : parseLatexImport(source, allowUnsafe),
        error: null,
      }
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [allowUnsafe, delimiter, mode, source])

  const result = parsed.result
  const needsUnsafeApproval = Boolean(
    mode === 'latex' && result?.unsafe && !allowUnsafe
  )
  const canPreview = Boolean(result && !needsUnsafeApproval)

  const handleImport = () => {
    if (!result || needsUnsafeApproval) return
    if (result.unsafe) {
      setConfirmationOpen(true)
      return
    }
    onImport(result.model)
  }

  const confirmUnsafeImport = () => {
    if (!result) return
    setConfirmationOpen(false)
    onImport(result.model)
  }

  return (
    <section
      className="vte-import-panel card"
      aria-labelledby="vte-import-title"
    >
      <div className="card-body">
        <div className="vte-import-heading">
          <h3 id="vte-import-title">Import table</h3>
          <p className="text-muted">
            Importing replaces the whole table. The LaTeX source document is not
            changed until you select Insert or Save.
          </p>
        </div>
        <div className="vte-import-content">
          <div className="vte-import-editor">
            <OLFormGroup controlId="vte-import-format">
              <OLFormLabel>Format</OLFormLabel>
              <OLFormSelect
                size="sm"
                value={mode}
                onChange={event => {
                  setMode(event.target.value as TableImportMode)
                  setModeSelectedManually(true)
                  setAllowUnsafe(false)
                }}
              >
                <option value="csv">CSV</option>
                <option value="latex">LaTeX</option>
              </OLFormSelect>
            </OLFormGroup>
            {mode === 'csv' && (
              <OLFormGroup controlId="vte-import-delimiter">
                <OLFormLabel>Delimiter</OLFormLabel>
                <OLFormSelect
                  size="sm"
                  value={delimiter}
                  onChange={event => {
                    setDelimiter(event.target.value as CsvImportDelimiter)
                    setAllowUnsafe(false)
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value=",">Comma</option>
                  <option value=";">Semicolon</option>
                  <option value={'\t'}>Tab</option>
                </OLFormSelect>
              </OLFormGroup>
            )}
            <OLFormGroup controlId="vte-import-source">
              <OLFormLabel>Table text</OLFormLabel>
              <OLFormControl
                as="textarea"
                autoFocus
                rows={9}
                spellCheck={false}
                value={source}
                onChange={event => {
                  const nextSource = event.target.value
                  setSource(nextSource)
                  if (!nextSource.trim()) {
                    setModeSelectedManually(false)
                  } else if (!modeSelectedManually) {
                    setMode(detectTableImportFormat(nextSource))
                  }
                  setAllowUnsafe(false)
                }}
                placeholder={
                  mode === 'csv'
                    ? 'Column A,Column B\nValue 1,Value 2'
                    : '\\begin{tabular}{lc}\nItem & Value \\\\\nExample & 1 \\\\\n\\end{tabular}'
                }
              />
            </OLFormGroup>
          </div>
          <div className="vte-import-preview" aria-live="polite">
            <h4>Preview</h4>
            {parsed.error && <Alert variant="danger">{parsed.error}</Alert>}
            {result && (
              <>
                <p>
                  {canPreview
                    ? `${result.rows} rows × ${result.columns} columns`
                    : 'Review the warnings before generating the preview.'}
                  {mode === 'csv' && (
                    <> · {delimiterLabel(result.metadata.delimiter)}</>
                  )}
                  {mode === 'latex' && result.metadata.environment && (
                    <> · {result.metadata.environment}</>
                  )}
                </p>
                {result.diagnostics.length > 0 && (
                  <ul className="vte-import-diagnostics">
                    {result.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.message}-${index}`}>
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                )}
                {canPreview && <ModelPreview result={result} />}
              </>
            )}
            {!source && <p>Enter table content to see a preview.</p>}
          </div>
        </div>
        <div className="vte-import-actions">
          <OLButton variant="secondary" onClick={onCancel}>
            Cancel
          </OLButton>
          {needsUnsafeApproval ? (
            <OLButton variant="primary" onClick={() => setAllowUnsafe(true)}>
              Continue with unsafe import
            </OLButton>
          ) : (
            <OLButton
              variant="primary"
              disabled={!result}
              onClick={handleImport}
            >
              {result?.unsafe ? 'Import anyway' : 'Import'}
            </OLButton>
          )}
        </div>
      </div>
      <VisualTableConfirmationDialog
        show={confirmationOpen}
        themed={themed}
        title="Import unsupported LaTeX?"
        message="This LaTeX contains unsupported structure and may not be preserved exactly. Import it anyway?"
        confirmLabel="Import anyway"
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={confirmUnsafeImport}
      />
    </section>
  )
}

function ModelPreview({ result }: { result: TableImportResult }) {
  const rowCount = Math.min(result.rows, 10)
  const columnCount = Math.min(result.columns, 10)
  return (
    <div className="vte-import-preview-table-wrapper">
      <table className="vte-import-preview-table">
        <tbody>
          {Array.from({ length: rowCount }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columnCount }, (_unused, column) => {
                const cell = cellAt(result.model, row, column)
                const value =
                  cell?.row === row && cell.column === column
                    ? cell.content.text || cell.content.rawLatex || ''
                    : ''
                return <td key={column}>{value}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {(result.rows > rowCount || result.columns > columnCount) && (
        <p>Preview limited to the first 10 rows and 10 columns.</p>
      )}
    </div>
  )
}
