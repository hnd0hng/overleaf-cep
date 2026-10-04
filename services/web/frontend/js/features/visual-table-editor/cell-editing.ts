export type CellEditingKeyboardEvent = {
  altKey: boolean
  ctrlKey: boolean
  isComposing: boolean
  key: string
  metaKey: boolean
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offset: number; offsetNode: Node } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

export const replacementTextForKey = (
  event: CellEditingKeyboardEvent
): string | null => {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    event.key.length !== 1
  ) {
    return null
  }

  return event.key
}

const offsetWithin = (container: HTMLElement, node: Node, offset: number) => {
  if (node !== container && !container.contains(node)) return null

  const range = document.createRange()
  range.selectNodeContents(container)
  range.setEnd(node, offset)
  return range.toString().length
}

export const caretOffsetFromPoint = (
  container: HTMLElement,
  clientX: number,
  clientY: number,
  valueLength: number
) => {
  const caretDocument = document as CaretDocument
  const position = caretDocument.caretPositionFromPoint?.(clientX, clientY)
  const range = position
    ? null
    : caretDocument.caretRangeFromPoint?.(clientX, clientY)
  const node = position?.offsetNode ?? range?.startContainer
  const offset = position?.offset ?? range?.startOffset

  if (!node || offset === undefined) return valueLength

  const measured = offsetWithin(container, node, offset)
  if (measured === null) return valueLength
  return Math.max(0, Math.min(valueLength, measured))
}
