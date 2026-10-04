import { useVirtualizer } from '@tanstack/react-virtual'
import { EditorView } from '@codemirror/view'
import {
  ChangeEvent,
  KeyboardEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import {
  detectDelimiter,
  exportCsv,
  parseDelimited,
  parseHtmlTable,
  parseSpreadsheetClipboard,
} from './csv'
import { generateLatex } from './latex'
import { TableHistory } from './history'
import {
  applyAlignment,
  applyBorders,
  applyTextStyle,
  cellAt,
  clearFormatting,
  deleteColumns,
  deleteRows,
  formatNumbers,
  insertColumn,
  insertRow,
  mergeSelection,
  moveColumn,
  moveRow,
  normalizeSelection,
  pasteMatrix,
  replaceText,
  selectedCells,
  splitSelection,
  transpose,
  updateCellText,
} from './model'
import { commitSession } from './source'
import { removeDraft, saveDraft } from './persistence'
import { proposePackages } from './packages'
import { useProjectContext } from '@/shared/context/project-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import VisualTableToolbarButton, {
  VisualTableColorPicker,
} from './components/visual-table-toolbar-button'
import useTableSelection from './hooks/use-table-selection'
import {
  CellPoint,
  CellSelection,
  EditorSession,
  HorizontalAlignment,
  TableModel,
} from './types'
import './visual-table-editor.scss'

type Props = {
  initialSession: EditorSession
  view: EditorView
  onClose: () => void
}

const download = (filename: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const clampPoint = (model: TableModel, point: CellPoint): CellPoint => ({
  row: Math.max(0, Math.min(model.rows.length - 1, point.row)),
  column: Math.max(0, Math.min(model.columns.length - 1, point.column)),
})

export default function VisualTableEditor({
  initialSession,
  view,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const { project, projectSnapshot } = useProjectContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { openDocs } = useEditorManagerContext()
  const { pathInFolder, findEntityByPath } = useFileTreePathContext()
  const history = useRef(new TableHistory(initialSession.model))
  const [model, setModel] = useState(initialSession.model)
  const [selection, setSelection] = useState(initialSession.selection)
  const [editing, setEditing] = useState<CellPoint | null>(null)
  const [sourceVisible, setSourceVisible] = useState(true)
  const [unsafeReview, setUnsafeReview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [matchIndex, setMatchIndex] = useState(-1)
  const [preservePasteFormatting, setPreservePasteFormatting] = useState(true)
  const [numberPrecision, setNumberPrecision] = useState(2)
  const [numberGrouping, setNumberGrouping] = useState(true)
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.')
  const viewportRef = useRef<HTMLDivElement>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const { beginSelection, extendSelection, isSelecting } = useTableSelection({
    columnCount: model.columns.length,
    gridRef: viewportRef,
    rowCount: model.rows.length,
    selection,
    setSelection,
  })
  const generated = useMemo(() => generateLatex(model), [model])
  const matches = useMemo(
    () =>
      find
        ? Object.values(model.cells)
            .filter(cell =>
              (cell.content.text || cell.content.rawLatex || '').includes(find)
            )
            .sort((a, b) => a.row - b.row || a.column - b.column)
        : [],
    [find, model.cells]
  )
  const session = useMemo(
    () => ({
      ...initialSession,
      model,
      selection,
      generatedLatex: generated.latex,
    }),
    [generated.latex, initialSession, model, selection]
  )

  const rowVirtualizer = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 42,
    overscan: 8,
  })

  const apply = useCallback(
    (operation: (current: TableModel) => TableModel) => {
      try {
        setError(null)
        setModel(current => {
          const next = operation(current)
          history.current.push(next)
          return next
        })
      } catch (operationError) {
        setError(
          operationError instanceof Error
            ? operationError.message
            : String(operationError)
        )
      }
    },
    []
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDraft(session, history.current.serialize(), {
        top: viewportRef.current?.scrollTop ?? 0,
        left: viewportRef.current?.scrollLeft ?? 0,
      }).catch(() => {})
    }, 750)
    return () => window.clearTimeout(timer)
  }, [session])

  const moveSelection = useCallback(
    (rowDelta: number, columnDelta: number, extend: boolean) => {
      setSelection(current => {
        const to = clampPoint(model, {
          row: current.to.row + rowDelta,
          column: current.to.column + columnDelta,
        })
        return extend ? { ...current, to } : { from: to, to }
      })
    },
    [model]
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      setModel(event.shiftKey ? history.current.redo() : history.current.undo())
      return
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      setModel(history.current.redo())
      return
    }
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelection({
        from: { row: 0, column: 0 },
        to: { row: model.rows.length - 1, column: model.columns.length - 1 },
      })
      return
    }
    if (command && event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      pasteSpecial()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      setEditing(selection.to)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      apply(current => {
        let next = current
        for (const cell of selectedCells(current, selection)) {
          next = updateCellText(
            next,
            { row: cell.row, column: cell.column },
            ''
          )
        }
        return next
      })
      return
    }
    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Tab: [0, event.shiftKey ? -1 : 1],
    }
    if (movement[event.key]) {
      event.preventDefault()
      const [row, column] = movement[event.key]
      moveSelection(row, column, event.shiftKey && event.key !== 'Tab')
    }
  }

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (editing || !viewportRef.current?.contains(document.activeElement))
        return
      event.preventDefault()
      const html = event.clipboardData?.getData('text/html')
      const formatted = html ? parseHtmlTable(html) : null
      if (formatted) {
        const matrix = formatted.map(row => row.map(cell => cell.text))
        apply(current => {
          const next = pasteMatrix(current, selection.to, matrix)
          if (preservePasteFormatting) {
            formatted.forEach((row, y) =>
              row.forEach((format, x) => {
                const cell = cellAt(
                  next,
                  selection.to.row + y,
                  selection.to.column + x
                )
                if (!cell) return
                cell.content.style = {
                  bold: format.bold,
                  italic: format.italic,
                  color: format.color,
                }
                cell.backgroundColor = format.backgroundColor
                cell.horizontalAlignment = format.horizontalAlignment
              })
            )
          }
          return next
        })
      } else {
        const plain = event.clipboardData?.getData('text/plain')
        if (plain)
          apply(current =>
            pasteMatrix(current, selection.to, parseSpreadsheetClipboard(plain))
          )
      }
    }
    const copyOrCut = (event: ClipboardEvent) => {
      if (editing || !viewportRef.current?.contains(document.activeElement))
        return
      const range = normalizeSelection(selection)
      const rows: string[] = []
      for (let row = range.minRow; row <= range.maxRow; row++) {
        const values: string[] = []
        for (
          let column = range.minColumn;
          column <= range.maxColumn;
          column++
        ) {
          const cell = cellAt(model, row, column)!
          values.push(
            cell.row === row && cell.column === column
              ? cell.content.text || cell.content.rawLatex || ''
              : ''
          )
        }
        rows.push(values.join('\t'))
      }
      event.preventDefault()
      event.clipboardData?.setData('text/plain', rows.join('\n'))
      if (event.type === 'cut') {
        apply(current => {
          let next = current
          for (const cell of selectedCells(current, selection)) {
            next = updateCellText(
              next,
              { row: cell.row, column: cell.column },
              ''
            )
          }
          return next
        })
      }
    }
    window.addEventListener('paste', paste)
    window.addEventListener('copy', copyOrCut)
    window.addEventListener('cut', copyOrCut)
    return () => {
      window.removeEventListener('paste', paste)
      window.removeEventListener('copy', copyOrCut)
      window.removeEventListener('cut', copyOrCut)
    }
  }, [apply, editing, model, preservePasteFormatting, selection])

  const setOption = <Key extends keyof TableModel['options']>(
    key: Key,
    value: TableModel['options'][Key]
  ) =>
    apply(current => ({
      ...current,
      options: { ...current.options, [key]: value },
    }))

  const selectedRange = normalizeSelection(selection)
  const columnTemplate = `44px repeat(${model.columns.length}, minmax(110px, 1fr))`

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const contents = await file.text()
    apply(current =>
      pasteMatrix(
        current,
        { row: 0, column: 0 },
        parseDelimited(contents, detectDelimiter(contents))
      )
    )
    event.target.value = ''
  }

  function pasteSpecial() {
    const value = window.prompt('Paste text to split into cells:')
    if (value == null) return
    const delimiter = window.prompt(
      'Delimiter: tab, comma, semicolon, whitespace, line, or custom',
      'tab'
    )
    if (delimiter == null) return
    const resolved =
      delimiter === 'tab'
        ? '\t'
        : delimiter === 'comma'
          ? ','
          : delimiter === 'semicolon'
            ? ';'
            : delimiter === 'whitespace'
              ? /\s+/
              : delimiter === 'line'
                ? '\n'
                : delimiter
    const matrix =
      delimiter === 'line'
        ? value.split(/\r?\n/).map(item => [item])
        : parseDelimited(value, resolved)
    apply(current => pasteMatrix(current, selection.to, matrix))
  }

  const resizeColumn = (
    event: PointerEvent<HTMLSpanElement>,
    column: number
  ) => {
    const start = event.clientX
    const current = model.columns[column]
    const initial = current.width.mode === 'fixed' ? current.width.value : 3
    const move = (moveEvent: globalThis.PointerEvent) => {
      const value = Math.max(0.5, initial + (moveEvent.clientX - start) / 30)
      setModel(previous => {
        const next = structuredClone(previous)
        next.columns[column].width = {
          mode: 'fixed',
          value: Math.round(value * 10) / 10,
          unit: 'cm',
        }
        return next
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // The history still points at the state from before the pointer drag.
      // Push the latest preview value once, so one resize is one undo step.
      setModel(latest => {
        history.current.push(latest)
        return latest
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const navigateMatch = (direction: 1 | -1) => {
    if (!matches.length) return
    const nextIndex = (matchIndex + direction + matches.length) % matches.length
    const match = matches[nextIndex]
    setMatchIndex(nextIndex)
    setSelection({
      from: { row: match.row, column: match.column },
      to: { row: match.row, column: match.column },
    })
    rowVirtualizer.scrollToIndex(match.row, { align: 'center' })
  }

  const commit = async () => {
    if (model.unsafeImport && !unsafeReview) {
      setUnsafeReview(true)
      return
    }
    if (
      model.unsafeImport &&
      !window.confirm(
        'This is an unsafe import. Confirm again that you want to replace the original source with the generated LaTeX shown in the diff preview.'
      )
    )
      return
    if (generated.packages.length) {
      const rootDocId = project?.rootDocId
      const rootPath = rootDocId
        ? pathInFolder(rootDocId)?.replace(/^\//, '')
        : null
      if (!rootDocId || !rootPath) {
        setError(
          'The main document could not be identified, so required packages were not inserted.'
        )
        return
      }
      try {
        await projectSnapshot.refresh()
        const availableFiles = projectSnapshot.getDocPaths().map(path => ({
          path,
          source: projectSnapshot.getDocContents(path) ?? '',
        }))
        const main =
          availableFiles.find(file => file.path === rootPath) ??
          (currentDocumentId === rootDocId
            ? { path: rootPath, source: view.state.doc.toString() }
            : null)
        if (!main) throw new Error(`Could not read main document ${rootPath}`)
        if (currentDocumentId === rootDocId)
          main.source = view.state.doc.toString()
        const proposals = proposePackages(
          generated.packages,
          main,
          availableFiles
        )
        const changes = proposals.filter(
          proposal => proposal.status !== 'present'
        )
        if (changes.length) {
          const description = changes
            .map(proposal => {
              const location = proposal.location!
              return `${location.file}:${location.line}\n- ${location.before || '(insert)'}\n+ ${location.after.trimEnd()}`
            })
            .join('\n\n')
          if (
            !window.confirm(
              `The generated table requires package changes:\n\n${description}\n\nApply these changes?`
            )
          )
            return

          const byFile = new Map<string, typeof changes>()
          for (const proposal of changes) {
            const file = proposal.location!.file
            byFile.set(file, [...(byFile.get(file) ?? []), proposal])
          }
          for (const [path, fileChanges] of byFile) {
            const found = findEntityByPath(path) ?? findEntityByPath(`/${path}`)
            if (!found || found.type !== 'doc')
              throw new Error(`Could not locate ${path}`)
            const documentId = found.entity._id
            const sorted = fileChanges.sort(
              (a, b) => b.location!.from - a.location!.from
            )
            if (documentId === currentDocumentId) {
              for (const proposal of sorted) {
                const location = proposal.location!
                if (
                  location.before &&
                  view.state.sliceDoc(location.from, location.to) !==
                    location.before
                ) {
                  throw new Error(
                    `${path} changed before packages could be inserted`
                  )
                }
              }
              view.dispatch({
                changes: sorted.map(proposal => ({
                  from: proposal.location!.from,
                  to: proposal.location!.to,
                  insert: proposal.location!.after,
                })),
                userEvent: 'input.visual-table-editor-packages',
              })
            } else {
              const document = openDocs.getDocument(documentId)
              if (!document) throw new Error(`Could not open ${path}`)
              await new Promise<void>((resolve, reject) =>
                document.join(error => (error ? reject(error) : resolve()))
              )
              const liveSource = document.getSnapshot()
              if (liveSource == null) throw new Error(`Could not read ${path}`)
              for (const proposal of sorted) {
                const location = proposal.location!
                if (
                  location.before &&
                  liveSource.slice(location.from, location.to) !==
                    location.before
                ) {
                  throw new Error(
                    `${path} changed before packages could be inserted`
                  )
                }
                if (location.before) {
                  document.submitOp({ p: location.from, d: location.before })
                }
                document.submitOp({ p: location.from, i: location.after })
              }
            }
          }
        }
      } catch (packageError) {
        setError(
          `Package changes were not applied: ${packageError instanceof Error ? packageError.message : String(packageError)}`
        )
        return
      }
    }
    const result = commitSession(view, initialSession.anchor, generated.latex)
    if (!result.ok) {
      setError(
        'The original table changed while the visual editor was open. No source was overwritten.'
      )
      return
    }
    await removeDraft(session).catch(() => {})
    onClose()
    window.setTimeout(() => view.focus(), 0)
  }

  return (
    <OLModal
      show
      onHide={onClose}
      backdrop="static"
      keyboard={false}
      clickOutsideDeactivates={false}
      size="lg"
      fullscreen="lg-down"
      className="visual-table-editor-modal"
    >
      <OLModalHeader closeButton>
        <OLModalTitle>Visual Table Editor</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <div
          className="vte-toolbar"
          role="toolbar"
          aria-label="Table operations"
        >
          <div className="vte-toolbar-group" role="group" aria-label="History">
            <VisualTableToolbarButton
              tooltipId="vte-undo"
              icon="undo"
              label="Undo"
              onClick={() => setModel(history.current.undo())}
            />
            <VisualTableToolbarButton
              tooltipId="vte-redo"
              icon="redo"
              label="Redo"
              onClick={() => setModel(history.current.redo())}
            />
          </div>
          <div className="vte-toolbar-group" role="group" aria-label="Rows">
            <VisualTableToolbarButton
              tooltipId="vte-row-above"
              icon="vertical_align_top"
              label="Insert row above"
              onClick={() =>
                apply(current => insertRow(current, selectedRange.minRow))
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-row-below"
              icon="vertical_align_bottom"
              label="Insert row below"
              onClick={() =>
                apply(current => insertRow(current, selectedRange.maxRow + 1))
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-delete-row"
              icon="delete"
              label="Delete row"
              onClick={() =>
                apply(current =>
                  deleteRows(
                    current,
                    selectedRange.minRow,
                    selectedRange.maxRow
                  )
                )
              }
            />
          </div>
          <div className="vte-toolbar-group" role="group" aria-label="Columns">
            <VisualTableToolbarButton
              tooltipId="vte-column-before"
              icon="format_indent_decrease"
              label="Insert column before"
              onClick={() =>
                apply(current => insertColumn(current, selectedRange.minColumn))
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-column-after"
              icon="format_indent_increase"
              label="Insert column after"
              onClick={() =>
                apply(current =>
                  insertColumn(current, selectedRange.maxColumn + 1)
                )
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-delete-column"
              icon="delete"
              label="Delete column"
              onClick={() =>
                apply(current =>
                  deleteColumns(
                    current,
                    selectedRange.minColumn,
                    selectedRange.maxColumn
                  )
                )
              }
            />
          </div>
          <div className="vte-toolbar-group" role="group" aria-label="Cells">
            <VisualTableToolbarButton
              tooltipId="vte-merge-cells"
              icon="cell_merge"
              label="Merge cells"
              onClick={() =>
                apply(current => mergeSelection(current, selection))
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-split-cell"
              icon="splitscreen_right"
              label="Split cell"
              onClick={() =>
                apply(current => splitSelection(current, selection))
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-transpose"
              icon="swap_horiz"
              label="Transpose table"
              onClick={() => apply(current => transpose(current))}
            />
          </div>
          <div
            className="vte-toolbar-group"
            role="group"
            aria-label="Horizontal alignment"
          >
            {(['left', 'center', 'right'] as HorizontalAlignment[]).map(
              alignment => (
                <VisualTableToolbarButton
                  key={alignment}
                  tooltipId={`vte-align-${alignment}`}
                  icon={`format_align_${alignment}`}
                  label={`Align ${alignment}`}
                  onClick={() =>
                    apply(current =>
                      applyAlignment(current, selection, alignment)
                    )
                  }
                />
              )
            )}
          </div>
          <div
            className="vte-toolbar-group"
            role="group"
            aria-label="Text style"
          >
            <VisualTableToolbarButton
              tooltipId="vte-bold"
              icon="format_bold"
              label="Bold"
              onClick={() =>
                apply(current =>
                  applyTextStyle(current, selection, { bold: true })
                )
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-italic"
              icon="format_italic"
              label="Italic"
              onClick={() =>
                apply(current =>
                  applyTextStyle(current, selection, { italic: true })
                )
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-clear-format"
              icon="format_clear"
              label="Clear formatting"
              onClick={() =>
                apply(current => clearFormatting(current, selection))
              }
            />
          </div>
          <div
            className="vte-toolbar-group"
            role="group"
            aria-label="Vertical alignment"
          >
            {(['top', 'middle', 'bottom'] as const).map(alignment => (
              <VisualTableToolbarButton
                key={alignment}
                tooltipId={`vte-vertical-align-${alignment}`}
                icon={
                  alignment === 'middle'
                    ? 'vertical_align_center'
                    : `vertical_align_${alignment}`
                }
                label={`Align ${alignment}`}
                onClick={() =>
                  apply(current =>
                    applyAlignment(current, selection, undefined, alignment)
                  )
                }
              />
            ))}
          </div>
          <div className="vte-toolbar-group" role="group" aria-label="Borders">
            {(
              [
                'all',
                'outer',
                'top',
                'bottom',
                'left',
                'right',
                'horizontal',
                'vertical',
                'none',
              ] as const
            ).map(border => (
              <VisualTableToolbarButton
                key={border}
                tooltipId={`vte-border-${border}`}
                icon={border === 'none' ? 'border_clear' : `border_${border}`}
                label={`Border ${border}`}
                onClick={() =>
                  apply(current => applyBorders(current, selection, border))
                }
              />
            ))}
          </div>
          <div className="vte-toolbar-group" role="group" aria-label="Colors">
            <VisualTableColorPicker
              tooltipId="vte-text-color"
              icon="format_color_text"
              label="Text color"
              onChange={color =>
                apply(current => applyTextStyle(current, selection, { color }))
              }
            />
            <VisualTableColorPicker
              tooltipId="vte-fill-color"
              icon="format_color_fill"
              label="Fill color"
              onChange={color =>
                apply(current => {
                  const next = structuredClone(current)
                  for (const cell of selectedCells(next, selection))
                    cell.backgroundColor = color
                  return next
                })
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-remove-text-color"
              icon="format_color_reset"
              label="Remove text color"
              onClick={() =>
                apply(current =>
                  applyTextStyle(current, selection, { color: undefined })
                )
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-remove-fill"
              icon="invert_colors_off"
              label="Remove fill color"
              onClick={() =>
                apply(current => {
                  const next = structuredClone(current)
                  for (const cell of selectedCells(next, selection))
                    cell.backgroundColor = undefined
                  return next
                })
              }
            />
          </div>
        </div>

        <div className="vte-options">
          <div
            className="vte-options-group"
            role="group"
            aria-label="Table settings"
          >
            <label>
              Environment{' '}
              <select
                value={model.options.environment}
                onChange={event =>
                  setOption(
                    'environment',
                    event.target.value as TableModel['options']['environment']
                  )
                }
              >
                <option value="tabular">tabular</option>
                <option value="tabularx">tabularx</option>
                <option value="longtable">longtable</option>
              </select>
            </label>
            <label>
              Style{' '}
              <select
                value={model.options.style}
                onChange={event =>
                  apply(current => {
                    const style = event.target.value as 'default' | 'booktabs'
                    const wholeTable = {
                      from: { row: 0, column: 0 },
                      to: {
                        row: current.rows.length - 1,
                        column: current.columns.length - 1,
                      },
                    }
                    const next = applyBorders(
                      current,
                      wholeTable,
                      style === 'default' ? 'all' : 'none'
                    )
                    next.options.style = style
                    return next
                  })
                }
              >
                <option value="default">Default</option>
                <option value="booktabs">Booktabs</option>
              </select>
            </label>
            <label>
              Scale{' '}
              <select
                value={model.options.scale}
                onChange={event =>
                  setOption(
                    'scale',
                    event.target.value as TableModel['options']['scale']
                  )
                }
              >
                <option value="none">None</option>
                <option value="textwidth">Text width</option>
                <option value="columnwidth">Column width</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={model.options.centered}
                onChange={event => setOption('centered', event.target.checked)}
              />{' '}
              Center table
            </label>
            <label>
              Caption{' '}
              <input
                value={model.options.caption}
                onChange={event => setOption('caption', event.target.value)}
              />
            </label>
            <label>
              Label{' '}
              <input
                value={model.options.label}
                onChange={event => setOption('label', event.target.value)}
              />
            </label>
          </div>
          <div
            className="vte-options-group"
            role="group"
            aria-label="Find and replace"
          >
            <label>
              Find{' '}
              <input
                value={find}
                onChange={event => setFind(event.target.value)}
              />
            </label>
            <label>
              Replace{' '}
              <input
                value={replace}
                onChange={event => setReplace(event.target.value)}
              />
            </label>
            <VisualTableToolbarButton
              tooltipId="vte-previous-match"
              icon="keyboard_arrow_up"
              label="Previous match"
              disabled={!matches.length}
              onClick={() => navigateMatch(-1)}
            />
            <VisualTableToolbarButton
              tooltipId="vte-next-match"
              icon="keyboard_arrow_down"
              label="Next match"
              disabled={!matches.length}
              onClick={() => navigateMatch(1)}
            />
            <VisualTableToolbarButton
              tooltipId="vte-replace-current"
              icon="find_replace"
              label="Replace current match"
              disabled={!matches.length || matchIndex < 0}
              onClick={() => {
                const match = matches[matchIndex]
                if (!match) return
                const target = {
                  from: { row: match.row, column: match.column },
                  to: { row: match.row, column: match.column },
                }
                apply(current =>
                  replaceText(current, find, replace, target, false)
                )
              }}
            />
            <VisualTableToolbarButton
              tooltipId="vte-replace-selected"
              icon="select_all"
              label="Replace in selected cells"
              onClick={() =>
                find &&
                apply(current =>
                  replaceText(current, find, replace, selection, true)
                )
              }
            />
            <VisualTableToolbarButton
              tooltipId="vte-replace-all"
              icon="published_with_changes"
              label="Replace all"
              onClick={() =>
                find &&
                apply(current =>
                  replaceText(current, find, replace, undefined, true)
                )
              }
            />
          </div>
          <div
            className="vte-options-group"
            role="group"
            aria-label="Number formatting"
          >
            <label>
              Decimals{' '}
              <input
                type="number"
                min="0"
                max="12"
                value={numberPrecision}
                onChange={event =>
                  setNumberPrecision(Number(event.target.value))
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={numberGrouping}
                onChange={event => setNumberGrouping(event.target.checked)}
              />{' '}
              Thousands separator
            </label>
            <label>
              Decimal{' '}
              <select
                value={decimalSeparator}
                onChange={event =>
                  setDecimalSeparator(event.target.value as '.' | ',')
                }
              >
                <option value=".">.</option>
                <option value=",">,</option>
              </select>
            </label>
            <VisualTableToolbarButton
              tooltipId="vte-format-numbers"
              icon="number"
              label="Format numbers"
              onClick={() =>
                apply(current =>
                  formatNumbers(
                    current,
                    selection,
                    numberPrecision,
                    numberGrouping,
                    decimalSeparator
                  )
                )
              }
            />
          </div>
          <div
            className="vte-options-group"
            role="group"
            aria-label="Data operations"
          >
            <VisualTableToolbarButton
              tooltipId="vte-repeating-header"
              icon="repeat"
              label="Toggle repeating header"
              onClick={() =>
                apply(current => {
                  const next = structuredClone(current)
                  for (
                    let row = selectedRange.minRow;
                    row <= selectedRange.maxRow;
                    row++
                  ) {
                    next.rows[row].repeatOnNewPage =
                      !next.rows[row].repeatOnNewPage
                  }
                  return next
                })
              }
            />
            <label>
              <input
                type="checkbox"
                checked={preservePasteFormatting}
                onChange={event =>
                  setPreservePasteFormatting(event.target.checked)
                }
              />{' '}
              Preserve paste formatting
            </label>
            <VisualTableToolbarButton
              tooltipId="vte-paste-special"
              icon="content_paste"
              label="Paste special"
              onClick={pasteSpecial}
            />
            <VisualTableToolbarButton
              tooltipId="vte-import-csv"
              icon="upload"
              label="Import CSV"
              onClick={() => csvInputRef.current?.click()}
            />
            <VisualTableToolbarButton
              tooltipId="vte-export-csv"
              icon="download"
              label="Export CSV"
              onClick={() =>
                download(
                  'table.csv',
                  exportCsv(model),
                  'text/csv;charset=utf-8'
                )
              }
            />
            <input
              ref={csvInputRef}
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={importCsv}
            />
          </div>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        {model.unsafeImport && (
          <div className="alert alert-warning">
            Unsafe import: unsupported source may be rewritten. Saving requires
            a second confirmation and diff review.
          </div>
        )}

        <div className="vte-workspace">
          <div
            className={`vte-grid ${isSelecting ? 'selecting' : ''}`}
            ref={viewportRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            <div
              className="vte-grid-header"
              style={{ gridTemplateColumns: columnTemplate }}
            >
              <div />
              {model.columns.map((column, index) => (
                <div
                  className={`vte-column-header ${
                    selectedRange.minRow === 0 &&
                    selectedRange.maxRow === model.rows.length - 1 &&
                    index >= selectedRange.minColumn &&
                    index <= selectedRange.maxColumn
                      ? 'selected'
                      : ''
                  }`}
                  key={column.id}
                  onPointerDown={event =>
                    beginSelection('columns', { row: 0, column: index }, event)
                  }
                  onPointerEnter={event =>
                    extendSelection('columns', { row: 0, column: index }, event)
                  }
                >
                  {index + 1}
                  <VisualTableToolbarButton
                    tooltipId={`vte-move-column-${index}-left`}
                    icon="arrow_left_alt"
                    label={`Move column ${index + 1} left`}
                    disabled={index === 0}
                    onClick={() =>
                      apply(current => moveColumn(current, index, index - 1))
                    }
                  />
                  <VisualTableToolbarButton
                    tooltipId={`vte-move-column-${index}-right`}
                    icon="arrow_right_alt"
                    label={`Move column ${index + 1} right`}
                    disabled={index === model.columns.length - 1}
                    onClick={() =>
                      apply(current => moveColumn(current, index, index + 1))
                    }
                  />
                  <select
                    aria-label={`Width for column ${index + 1}`}
                    value={column.width.mode}
                    onChange={event =>
                      apply(current => {
                        const next = structuredClone(current)
                        next.columns[index].width =
                          event.target.value === 'auto'
                            ? { mode: 'auto' }
                            : event.target.value === 'flex'
                              ? { mode: 'flex' }
                              : { mode: 'fixed', value: 3, unit: 'cm' }
                        return next
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="fixed">Fixed</option>
                    <option value="flex">Flex</option>
                  </select>
                  {column.width.mode === 'fixed' && (
                    <input
                      className="vte-width-input"
                      aria-label={`Explicit width for column ${index + 1}`}
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={column.width.value}
                      onChange={event =>
                        apply(current => {
                          const next = structuredClone(current)
                          next.columns[index].width = {
                            mode: 'fixed',
                            value: Number(event.target.value),
                            unit:
                              column.width.mode === 'fixed'
                                ? column.width.unit
                                : 'cm',
                          }
                          return next
                        })
                      }
                    />
                  )}
                  <span
                    className="vte-resize-handle"
                    onPointerDown={event => resizeColumn(event, index)}
                  />
                </div>
              ))}
            </div>
            <div
              className="vte-grid-body"
              style={{
                height: rowVirtualizer.getTotalSize(),
                minWidth: model.columns.length * 110 + 44,
              }}
            >
              {rowVirtualizer.getVirtualItems().map(virtualRow => (
                <div
                  className="vte-row"
                  key={model.rows[virtualRow.index].id}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns: columnTemplate,
                  }}
                >
                  <div
                    className={`vte-row-header ${
                      selectedRange.minColumn === 0 &&
                      selectedRange.maxColumn === model.columns.length - 1 &&
                      virtualRow.index >= selectedRange.minRow &&
                      virtualRow.index <= selectedRange.maxRow
                        ? 'selected'
                        : ''
                    }`}
                    onPointerDown={event =>
                      beginSelection(
                        'rows',
                        { row: virtualRow.index, column: 0 },
                        event
                      )
                    }
                    onPointerEnter={event =>
                      extendSelection(
                        'rows',
                        { row: virtualRow.index, column: 0 },
                        event
                      )
                    }
                  >
                    {virtualRow.index + 1}
                    <VisualTableToolbarButton
                      tooltipId={`vte-move-row-${virtualRow.index}-up`}
                      icon="arrow_upward"
                      label={`Move row ${virtualRow.index + 1} up`}
                      disabled={virtualRow.index === 0}
                      onClick={() =>
                        apply(current =>
                          moveRow(
                            current,
                            virtualRow.index,
                            virtualRow.index - 1
                          )
                        )
                      }
                    />
                    <VisualTableToolbarButton
                      tooltipId={`vte-move-row-${virtualRow.index}-down`}
                      icon="arrow_downward"
                      label={`Move row ${virtualRow.index + 1} down`}
                      disabled={virtualRow.index === model.rows.length - 1}
                      onClick={() =>
                        apply(current =>
                          moveRow(
                            current,
                            virtualRow.index,
                            virtualRow.index + 1
                          )
                        )
                      }
                    />
                  </div>
                  {model.columns.map((_, column) => {
                    const cell = cellAt(model, virtualRow.index, column)!
                    if (cell.row !== virtualRow.index || cell.column !== column)
                      return null
                    const selected = selectedCells(model, selection).some(
                      item => item.id === cell.id
                    )
                    const isEditing =
                      editing?.row === cell.row &&
                      editing.column === cell.column
                    return (
                      <div
                        key={cell.id}
                        className={`vte-cell ${selected ? 'selected' : ''}`}
                        style={{
                          gridColumn: `${column + 2} / span ${cell.columnSpan}`,
                          height: Math.max(40, cell.rowSpan * 42 - 2),
                          backgroundColor: cell.backgroundColor,
                        }}
                        onPointerDown={event =>
                          beginSelection(
                            'cells',
                            { row: cell.row, column: cell.column },
                            event
                          )
                        }
                        onPointerEnter={event =>
                          extendSelection(
                            'cells',
                            { row: cell.row, column: cell.column },
                            event
                          )
                        }
                        onDoubleClick={() =>
                          setEditing({ row: cell.row, column: cell.column })
                        }
                      >
                        {isEditing ? (
                          <textarea
                            autoFocus
                            value={
                              cell.content.text || cell.content.rawLatex || ''
                            }
                            onChange={event =>
                              apply(current =>
                                updateCellText(
                                  current,
                                  { row: cell.row, column: cell.column },
                                  event.target.value
                                )
                              )
                            }
                            onBlur={() => setEditing(null)}
                            onKeyDown={event => {
                              if (
                                event.key === 'Escape' ||
                                (event.key === 'Enter' && !event.shiftKey)
                              ) {
                                event.preventDefault()
                                setEditing(null)
                              }
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              textAlign: cell.horizontalAlignment,
                              fontWeight: cell.content.style?.bold
                                ? 'bold'
                                : undefined,
                              fontStyle: cell.content.style?.italic
                                ? 'italic'
                                : undefined,
                              color: cell.content.style?.color,
                            }}
                          >
                            {cell.content.text || cell.content.rawLatex}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          {sourceVisible && (
            <div className="vte-source-preview">
              <div className="vte-source-heading">
                LaTeX preview{' '}
                <VisualTableToolbarButton
                  tooltipId="vte-copy-latex"
                  icon="content_copy"
                  label="Copy LaTeX"
                  onClick={() => navigator.clipboard.writeText(generated.latex)}
                />
              </div>
              <pre>{generated.latex}</pre>
              {generated.packages.length > 0 && (
                <div className="vte-packages">
                  Required packages: {generated.packages.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
        <VisualTableToolbarButton
          tooltipId="vte-toggle-latex-preview"
          icon={sourceVisible ? 'visibility_off' : 'visibility'}
          label={`${sourceVisible ? 'Hide' : 'Show'} LaTeX preview`}
          active={sourceVisible}
          className="vte-preview-toggle"
          onClick={() => setSourceVisible(value => !value)}
        />
        {unsafeReview && (
          <div className="vte-unsafe-review">
            <h3>Mandatory unsafe-import diff review</h3>
            <div className="vte-diff">
              <section>
                <h4>Original</h4>
                <pre>{initialSession.anchor.originalSource}</pre>
              </section>
              <section>
                <h4>Generated</h4>
                <pre>{generated.latex}</pre>
              </section>
            </div>
          </div>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onClose}>
          {t('close')}
        </OLButton>
        <OLButton variant="primary" onClick={commit}>
          {model.unsafeImport && !unsafeReview
            ? 'Review changes'
            : initialSession.anchor.mode === 'new'
              ? 'Insert'
              : 'Save'}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
