import { syntaxTree } from '@codemirror/language'
import { ChangeSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { diffChars } from 'diff'
import { SyntaxNode } from '@lezer/common'
import { fingerprintSource } from './latex'
import { SourceAnchor } from './types'

export type LocatedTable = { from: number; to: number; source: string }

const supportedEnvironment = /^(table\*?|tabular|tabularx|longtable)$/

export const locateTableAtSelection = (
  view: EditorView
): LocatedTable | null => {
  const position = view.state.selection.main.head
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(
    position,
    -1
  )
  let best: LocatedTable | null = null
  while (node) {
    if (
      node.type.is('TableEnvironment') ||
      node.type.is('TabularEnvironment')
    ) {
      const source = view.state.sliceDoc(node.from, node.to)
      const name = source.match(/^\\begin\{([^}]+)\}/)?.[1]
      if (name && supportedEnvironment.test(name)) {
        best = { from: node.from, to: node.to, source }
        if (node.type.is('TableEnvironment')) return best
      }
    }
    node = node.parent
  }
  return best
}

export const createSourceAnchor = (
  view: EditorView,
  projectId: string,
  documentId: string,
  mode: 'new' | 'edit',
  located?: LocatedTable | null
): SourceAnchor => {
  const from = located?.from ?? view.state.selection.main.head
  const to = located?.to ?? from
  const source = located?.source ?? ''
  return {
    projectId,
    documentId,
    mode,
    from,
    to,
    originalSource: source,
    fingerprint: fingerprintSource(source),
    beforeContext: view.state.sliceDoc(Math.max(0, from - 80), from),
    afterContext: view.state.sliceDoc(
      to,
      Math.min(view.state.doc.length, to + 80)
    ),
  }
}

const minimalChanges = (
  from: number,
  before: string,
  after: string
): ChangeSpec[] => {
  const changes: ChangeSpec[] = []
  let oldPosition = from
  for (const part of diffChars(before, after)) {
    if (part.added) {
      changes.push({ from: oldPosition, insert: part.value })
    } else if (part.removed) {
      changes.push({
        from: oldPosition,
        to: oldPosition + part.value.length,
        insert: '',
      })
      oldPosition += part.value.length
    } else {
      oldPosition += part.value.length
    }
  }
  return changes
}

export type CommitResult =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'source-changed' | 'ambiguous-source' }

export const commitSession = (
  view: EditorView,
  anchor: SourceAnchor,
  latex: string
): CommitResult => {
  if (anchor.mode === 'new') {
    const position = view.state.selection.main.head
    const line = view.state.doc.lineAt(position)
    const insertAt = line.text.trim() ? line.to : position
    const prefix = line.text.trim() ? '\n' : ''
    view.dispatch({
      changes: { from: insertAt, insert: `${prefix}${latex}\n` },
      userEvent: 'input.visual-table-editor',
    })
    return { ok: true, from: insertAt, to: insertAt + latex.length + 1 }
  }

  let from = anchor.from
  let current = view.state.sliceDoc(anchor.from, anchor.to)
  if (current !== anchor.originalSource) {
    const document = view.state.doc.toString()
    const first = document.indexOf(anchor.originalSource)
    if (first < 0) return { ok: false, reason: 'source-changed' }
    if (document.indexOf(anchor.originalSource, first + 1) >= 0) {
      return { ok: false, reason: 'ambiguous-source' }
    }
    from = first
    current = anchor.originalSource
  }
  view.dispatch({
    changes: minimalChanges(from, current, latex),
    userEvent: 'input.visual-table-editor',
  })
  return { ok: true, from, to: from + latex.length }
}
