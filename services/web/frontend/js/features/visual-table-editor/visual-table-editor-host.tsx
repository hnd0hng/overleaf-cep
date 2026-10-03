import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
import { FullSizeLoadingSpinner } from '@/shared/components/loading-spinner'
import {
  subscribeVisualTableEditor,
  VisualTableEditorOpenRequest,
} from './controller'

const VisualTableEditor = lazy(
  () =>
    import(
      /* webpackChunkName: "visual-table-editor" */ './visual-table-editor-entry'
    )
)

export default function VisualTableEditorHost() {
  const view = useCodeMirrorViewContext()
  const { projectId } = useProjectContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const [request, setRequest] = useState<VisualTableEditorOpenRequest | null>(
    null
  )

  const open = useCallback(
    (nextRequest: VisualTableEditorOpenRequest) => {
      if (currentDocumentId) setRequest(nextRequest)
    },
    [currentDocumentId]
  )

  useEffect(() => subscribeVisualTableEditor(open), [open])

  const close = useCallback(() => setRequest(null), [])

  if (!request || !currentDocumentId) return null
  return (
    <Suspense fallback={<FullSizeLoadingSpinner delay={500} />}>
      <VisualTableEditor
        request={request}
        view={view}
        projectId={projectId}
        documentId={currentDocumentId}
        onClose={close}
      />
    </Suspense>
  )
}
