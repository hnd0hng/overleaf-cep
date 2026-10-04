import { useEffect, useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormSelect from '@/shared/components/ol/ol-form-select'

export type PasteSpecialDelimiter =
  | 'tab'
  | 'comma'
  | 'semicolon'
  | 'whitespace'
  | 'line'
  | 'custom'

type Props = {
  onCancel: () => void
  onPaste: (
    source: string,
    delimiter: PasteSpecialDelimiter,
    custom: string
  ) => void
  show: boolean
  themed: boolean
}

export default function VisualTablePasteSpecialDialog({
  onCancel,
  onPaste,
  show,
  themed,
}: Props) {
  const [source, setSource] = useState('')
  const [delimiter, setDelimiter] = useState<PasteSpecialDelimiter>('tab')
  const [customDelimiter, setCustomDelimiter] = useState('')

  useEffect(() => {
    if (!show) {
      setSource('')
      setDelimiter('tab')
      setCustomDelimiter('')
    }
  }, [show])

  return (
    <OLModal show={show} onHide={onCancel} themed={themed}>
      <OLModalHeader>
        <OLModalTitle>Paste special</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <OLFormGroup className="mb-3" controlId="vte-paste-special-source">
          <OLFormLabel>Table text</OLFormLabel>
          <OLFormControl
            as="textarea"
            autoFocus
            rows={8}
            spellCheck={false}
            value={source}
            onChange={event => setSource(event.target.value)}
          />
        </OLFormGroup>
        <OLFormGroup controlId="vte-paste-special-delimiter">
          <OLFormLabel>Split cells by</OLFormLabel>
          <OLFormSelect
            value={delimiter}
            onChange={event =>
              setDelimiter(event.target.value as PasteSpecialDelimiter)
            }
          >
            <option value="tab">Tab</option>
            <option value="comma">Comma</option>
            <option value="semicolon">Semicolon</option>
            <option value="whitespace">Whitespace</option>
            <option value="line">New line</option>
            <option value="custom">Custom delimiter</option>
          </OLFormSelect>
        </OLFormGroup>
        {delimiter === 'custom' && (
          <OLFormGroup
            className="mt-3"
            controlId="vte-paste-special-custom-delimiter"
          >
            <OLFormLabel>Custom delimiter</OLFormLabel>
            <OLFormControl
              value={customDelimiter}
              onChange={event => setCustomDelimiter(event.target.value)}
            />
          </OLFormGroup>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onCancel}>
          Cancel
        </OLButton>
        <OLButton
          variant="primary"
          disabled={!source || (delimiter === 'custom' && !customDelimiter)}
          onClick={() => onPaste(source, delimiter, customDelimiter)}
        >
          Paste
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
