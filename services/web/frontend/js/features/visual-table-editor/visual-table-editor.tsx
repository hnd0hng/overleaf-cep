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
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() => setModel(history.current.undo())}
          >
            Undo
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() => setModel(history.current.redo())}
          >
            Redo
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current => insertRow(current, selectedRange.minRow))
            }
          >
            Row above
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current => insertRow(current, selectedRange.maxRow + 1))
            }
          >
            Row below
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current =>
                deleteRows(current, selectedRange.minRow, selectedRange.maxRow)
              )
            }
          >
            Delete row
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current => insertColumn(current, selectedRange.minColumn))
            }
          >
            Column before
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current =>
                insertColumn(current, selectedRange.maxColumn + 1)
              )
            }
          >
            Column after
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current =>
                deleteColumns(
                  current,
                  selectedRange.minColumn,
                  selectedRange.maxColumn
                )
              )
            }
          >
            Delete column
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() => apply(current => mergeSelection(current, selection))}
          >
            Merge
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() => apply(current => splitSelection(current, selection))}
          >
            Split
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() => apply(current => transpose(current))}
          >
            Transpose
          </OLButton>
          {(['left', 'center', 'right'] as HorizontalAlignment[]).map(
            alignment => (
              <OLButton
                key={alignment}
                size="sm"
                variant="secondary"
                onClick={() =>
                  apply(current =>
                    applyAlignment(current, selection, alignment)
                  )
                }
              >
                {alignment}
              </OLButton>
            )
          )}
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current =>
                applyTextStyle(current, selection, { bold: true })
              )
            }
          >
            Bold
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current =>
                applyTextStyle(current, selection, { italic: true })
              )
            }
          >
            Italic
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current => clearFormatting(current, selection))
            }
          >
            Clear format
          </OLButton>
          {(['top', 'middle', 'bottom'] as const).map(alignment => (
            <OLButton
              key={alignment}
              size="sm"
              variant="secondary"
              onClick={() =>
                apply(current =>
                  applyAlignment(current, selection, undefined, alignment)
                )
              }
            >
              V-{alignment}
            </OLButton>
          ))}
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
            <OLButton
              key={border}
              size="sm"
              variant="secondary"
              onClick={() =>
                apply(current => applyBorders(current, selection, border))
              }
            >
              Border {border}
            </OLButton>
          ))}
          <label>
            Text{' '}
            <input
              type="color"
              onChange={event =>
                apply(current =>
                  applyTextStyle(current, selection, {
                    color: event.target.value,
                  })
                )
              }
            />
          </label>
          <label>
            Fill{' '}
            <input
              type="color"
              onChange={event =>
                apply(current => {
                  const next = structuredClone(current)
                  for (const cell of selectedCells(next, selection))
                    cell.backgroundColor = event.target.value
                  return next
                })
              }
            />
          </label>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current =>
                applyTextStyle(current, selection, { color: undefined })
              )
            }
          >
            Remove text color
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              apply(current => {
                const next = structuredClone(current)
                for (const cell of selectedCells(next, selection))
                  cell.backgroundColor = undefined
                return next
              })
            }
          >
            Remove fill
          </OLButton>
        </div>

        <div className="vte-options">
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
          <OLButton
            size="sm"
            variant="secondary"
            disabled={!matches.length}
            onClick={() => navigateMatch(-1)}
          >
            Previous match
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            disabled={!matches.length}
            onClick={() => navigateMatch(1)}
          >
            Next match
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
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
          >
            Replace current
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              find &&
              apply(current =>
                replaceText(current, find, replace, selection, true)
              )
            }
          >
            Replace selected
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              find &&
              apply(current =>
                replaceText(current, find, replace, undefined, true)
              )
            }
          >
            Replace all
          </OLButton>
          <label>
            Decimals{' '}
            <input
              type="number"
              min="0"
              max="12"
              value={numberPrecision}
              onChange={event => setNumberPrecision(Number(event.target.value))}
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
          <OLButton
            size="sm"
            variant="secondary"
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
          >
            Format numbers
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
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
          >
            Toggle repeating header
          </OLButton>
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
          <OLButton size="sm" variant="secondary" onClick={pasteSpecial}>
            Paste special
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() => csvInputRef.current?.click()}
          >
            Import CSV
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            onClick={() =>
              download('table.csv', exportCsv(model), 'text/csv;charset=utf-8')
            }
          >
            Export CSV
          </OLButton>
          <input
            ref={csvInputRef}
            hidden
            type="file"
            accept=".csv,text/csv"
            onChange={importCsv}
          />
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
            className="vte-grid"
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
                  className="vte-column-header"
                  key={column.id}
                  onClick={() =>
                    setSelection({
                      from: { row: 0, column: index },
                      to: { row: model.rows.length - 1, column: index },
                    })
                  }
                >
                  {index + 1}
                  <button
                    type="button"
                    aria-label={`Move column ${index + 1} left`}
                    disabled={index === 0}
                    onClick={() =>
                      apply(current => moveColumn(current, index, index - 1))
                    }
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label={`Move column ${index + 1} right`}
                    disabled={index === model.columns.length - 1}
                    onClick={() =>
                      apply(current => moveColumn(current, index, index + 1))
                    }
                  >
                    ›
                  </button>
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
                    className="vte-row-header"
                    onClick={() =>
                      setSelection({
                        from: { row: virtualRow.index, column: 0 },
                        to: {
                          row: virtualRow.index,
                          column: model.columns.length - 1,
                        },
                      })
                    }
                  >
                    {virtualRow.index + 1}
                    <button
                      type="button"
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
                    >
                      ↑
                    </button>
                    <button
                      type="button"
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
                    >
                      ↓
                    </button>
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
                        onPointerDown={event => {
                          const point = { row: cell.row, column: cell.column }
                          setSelection(current =>
                            event.shiftKey
                              ? { ...current, to: point }
                              : { from: point, to: point }
                          )
                        }}
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
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(generated.latex)}
                >
                  Copy
                </button>
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
        <button
          type="button"
          className="btn btn-link"
          onClick={() => setSourceVisible(value => !value)}
        >
          {sourceVisible ? 'Hide' : 'Show'} LaTeX preview
        </button>
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
          Cancel
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
