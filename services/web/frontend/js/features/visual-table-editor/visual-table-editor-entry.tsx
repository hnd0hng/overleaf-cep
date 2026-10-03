import { EditorView } from '@codemirror/view'
import { useEffect, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { VisualTableEditorOpenRequest } from './controller'
import { generateLatex, parseLatexTable } from './latex'
import { createSourceAnchor, locateTableAtSelection } from './source'
import { createTableModel, EditorSession } from './types'
import VisualTableEditor from './visual-table-editor'
import { loadDrafts, removeDraft } from './persistence'

type Props = {
  request: VisualTableEditorOpenRequest
  view: EditorView
  projectId: string
  documentId: string
  onClose: () => void
}

export default function VisualTableEditorEntry({
  request,
  view,
  projectId,
  documentId,
  onClose,
}: Props) {
  const [session, setSession] = useState<EditorSession | null>(null)

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      const located =
        request.mode === 'edit' ? locateTableAtSelection(view) : null
      if (request.mode === 'edit' && !located) {
        window.alert('Place the cursor inside a supported LaTeX table first.')
        onClose()
        return
      }
      const anchor = createSourceAnchor(
        view,
        projectId,
        documentId,
        request.mode,
        located
      )
      let model = createTableModel()
      if (located) {
        try {
          let parsed = parseLatexTable(located.source)
          if (parsed.unsafe) {
            const accepted = window.confirm(
              `This table contains unsupported LaTeX and may not be preserved exactly.\n\n${parsed.diagnostics.map(item => item.message).join('\n')}\n\nOpen in unsafe mode?`
            )
            if (!accepted) {
              onClose()
              return
            }
            parsed = parseLatexTable(located.source, true)
          }
          model = parsed.model
        } catch (error) {
          window.alert(
            `The table cannot be opened: ${error instanceof Error ? error.message : String(error)}`
          )
          onClose()
          return
        }
      }

      const drafts = (await loadDrafts(documentId).catch(() => []))
        .filter(draft => draft.session.anchor.mode === request.mode)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const unchanged = drafts.find(
        draft => draft.session.anchor.fingerprint === anchor.fingerprint
      )
      if (
        unchanged &&
        window.confirm(
          'An unfinished Visual Table Editor draft was found for this unchanged source. Resume it?'
        )
      ) {
        if (!cancelled) {
          setSession({ ...unchanged.session, anchor })
        }
        return
      }
      const changed = drafts.find(
        draft =>
          request.mode === 'edit' &&
          Math.abs(draft.session.anchor.from - anchor.from) < 500
      )
      if (changed) {
        const openCurrent = window.confirm(
          'A draft exists, but the corresponding LaTeX source has changed. Press OK to open the current source, or Cancel to review recovery options.'
        )
        if (!openCurrent) {
          const restoreAsNew = window.confirm(
            'Restore the draft as a new table at the current cursor? Press Cancel to discard the old draft.'
          )
          if (restoreAsNew) {
            const newAnchor = createSourceAnchor(
              view,
              projectId,
              documentId,
              'new'
            )
            if (!cancelled) {
              setSession({
                ...changed.session,
                id: uuid(),
                anchor: newAnchor,
                model: { ...changed.session.model, unsafeImport: true },
              })
            }
            return
          }
          await removeDraft(changed.session).catch(() => {})
        }
      }
      if (!cancelled) {
        setSession({
          id: uuid(),
          anchor,
          model,
          selection: {
            from: { row: 0, column: 0 },
            to: { row: 0, column: 0 },
          },
          generatedLatex: generateLatex(model).latex,
        })
      }
    }
    void initialize().catch(error => {
      if (cancelled) return
      window.alert(
        `The Visual Table Editor could not be opened: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      onClose()
    })
    return () => {
      cancelled = true
    }
  }, [documentId, onClose, projectId, request.mode, view])

  return session ? (
    <VisualTableEditor initialSession={session} view={view} onClose={onClose} />
  ) : null
}
