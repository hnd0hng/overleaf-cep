import { expect } from 'chai'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import {
  caretOffsetFromPoint,
  CellEditingKeyboardEvent,
  replacementTextForKey,
} from '@/features/visual-table-editor/cell-editing'
import VisualTableCellEditor from '@/features/visual-table-editor/components/visual-table-cell-editor'

const keyboardEvent = (
  overrides: Partial<CellEditingKeyboardEvent> = {}
): CellEditingKeyboardEvent => ({
  altKey: false,
  ctrlKey: false,
  isComposing: false,
  key: 'x',
  metaKey: false,
  ...overrides,
})

describe('visual table cell editing', function () {
  describe('replacementTextForKey', function () {
    it('accepts printable characters, including spaces', function () {
      expect(replacementTextForKey(keyboardEvent())).to.equal('x')
      expect(replacementTextForKey(keyboardEvent({ key: ' ' }))).to.equal(' ')
    })

    it('ignores shortcuts, composition, and non-printable keys', function () {
      expect(replacementTextForKey(keyboardEvent({ ctrlKey: true }))).to.equal(
        null
      )
      expect(replacementTextForKey(keyboardEvent({ metaKey: true }))).to.equal(
        null
      )
      expect(replacementTextForKey(keyboardEvent({ altKey: true }))).to.equal(
        null
      )
      expect(
        replacementTextForKey(keyboardEvent({ isComposing: true }))
      ).to.equal(null)
      expect(replacementTextForKey(keyboardEvent({ key: 'Enter' }))).to.equal(
        null
      )
    })
  })

  describe('caretOffsetFromPoint', function () {
    it('measures the clicked text offset and clamps it to the value', function () {
      const container = document.createElement('div')
      const text = document.createTextNode('masked value')
      container.appendChild(text)
      document.body.appendChild(container)

      const caretDocument = document as Document & {
        caretPositionFromPoint?: () => {
          offset: number
          offsetNode: Node
        }
      }
      const original = Object.getOwnPropertyDescriptor(
        document,
        'caretPositionFromPoint'
      )
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offset: 6, offsetNode: text }),
      })

      try {
        expect(caretOffsetFromPoint(container, 10, 20, 4)).to.equal(4)
      } finally {
        container.remove()
        if (original) {
          Object.defineProperty(document, 'caretPositionFromPoint', original)
        } else {
          Object.defineProperty(document, 'caretPositionFromPoint', {
            configurable: true,
            value: undefined,
          })
        }
      }
    })

    it('places the caret at the end when the browser has no valid position', function () {
      const container = document.createElement('div')
      expect(caretOffsetFromPoint(container, 10, 20, 7)).to.equal(7)
    })
  })

  it('focuses the editor at the requested caret position', function () {
    render(<CellEditorHarness />)

    const editor = screen.getByRole('textbox', {
      name: 'Edit masked cell',
    }) as HTMLTextAreaElement
    expect(document.activeElement).to.equal(editor)
    expect(editor.selectionStart).to.equal(2)
    expect(editor.selectionEnd).to.equal(2)

    fireEvent.change(editor, { target: { value: 'replacement' } })
    expect(editor.value).to.equal('replacement')
  })
})

function CellEditorHarness() {
  const [value, setValue] = useState('masked value')

  return (
    <VisualTableCellEditor
      ariaLabel="Edit masked cell"
      initialCaretPosition={2}
      onBlur={() => {}}
      onChange={setValue}
      onKeyDown={() => {}}
      value={value}
    />
  )
}
