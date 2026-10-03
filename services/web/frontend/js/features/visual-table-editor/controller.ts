export type VisualTableEditorOpenRequest = {
  mode: 'new' | 'edit'
}

type Listener = (request: VisualTableEditorOpenRequest) => void
const listeners = new Set<Listener>()

export const openVisualTableEditor = (
  request: VisualTableEditorOpenRequest
) => {
  for (const listener of listeners) listener(request)
}

export const subscribeVisualTableEditor = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
