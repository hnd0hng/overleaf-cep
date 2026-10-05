export const copyText = async (
  value: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard,
  documentRoot = document
) => {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value)
      return true
    } catch {
      // Fall through to the synchronous fallback while the user gesture is active.
    }
  }

  const textarea = documentRoot.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  documentRoot.body.appendChild(textarea)
  textarea.select()

  try {
    return documentRoot.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
