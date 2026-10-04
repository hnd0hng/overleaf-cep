import { KeyboardEventHandler, useLayoutEffect, useRef } from 'react'
import OLFormControl from '@/shared/components/ol/ol-form-control'

type Props = {
  ariaLabel: string
  initialCaretPosition: number
  onBlur: () => void
  onChange: (value: string) => void
  onKeyDown: KeyboardEventHandler<HTMLInputElement>
  value: string
}

export default function VisualTableCellEditor({
  ariaLabel,
  initialCaretPosition,
  onBlur,
  onChange,
  onKeyDown,
  value,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const initialCaret = useRef(initialCaretPosition)

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus({ preventScroll: true })
    input.setSelectionRange(initialCaret.current, initialCaret.current)
  }, [])

  return (
    <OLFormControl
      aria-label={ariaLabel}
      as="textarea"
      onBlur={onBlur}
      onChange={event => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      ref={inputRef}
      value={value}
    />
  )
}
