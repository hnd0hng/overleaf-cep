import { openDB, DBSchema } from 'idb'
import { EditorSession } from './types'

type PersistedDraft = {
  key: string
  session: EditorSession
  history?: unknown
  scroll?: { top: number; left: number }
  updatedAt: number
}

interface VisualTableEditorDatabase extends DBSchema {
  drafts: {
    key: string
    value: PersistedDraft
    indexes: { 'by-document': string; 'by-updated': number }
  }
}

const database = () =>
  openDB<VisualTableEditorDatabase>('overleaf-visual-table-editor', 1, {
    upgrade(db) {
      const store = db.createObjectStore('drafts', { keyPath: 'key' })
      store.createIndex('by-document', 'session.anchor.documentId')
      store.createIndex('by-updated', 'updatedAt')
    },
  })

export const draftKey = (session: EditorSession) =>
  [
    session.anchor.projectId,
    session.anchor.documentId,
    session.anchor.mode,
    session.anchor.mode === 'edit' ? session.anchor.fingerprint : session.id,
  ].join(':')

export const saveDraft = async (
  session: EditorSession,
  history?: unknown,
  scroll?: { top: number; left: number }
) => {
  const db = await database()
  await db.put('drafts', {
    key: draftKey(session),
    session,
    history,
    scroll,
    updatedAt: Date.now(),
  })
}

export const loadDrafts = async (documentId: string) => {
  const db = await database()
  return db.getAllFromIndex('drafts', 'by-document', documentId)
}

export const removeDraft = async (session: EditorSession) => {
  const db = await database()
  await db.delete('drafts', draftKey(session))
}

export const pruneDrafts = async (maximumAgeMs = 30 * 24 * 60 * 60 * 1000) => {
  const db = await database()
  const transaction = db.transaction('drafts', 'readwrite')
  let cursor = await transaction.store.index('by-updated').openCursor()
  const cutoff = Date.now() - maximumAgeMs
  while (cursor && cursor.value.updatedAt < cutoff) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await transaction.done
}
