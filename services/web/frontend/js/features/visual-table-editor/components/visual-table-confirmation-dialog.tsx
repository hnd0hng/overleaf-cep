import { ReactNode } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

type Props = {
  cancelLabel?: string
  confirmLabel: string
  message: ReactNode
  onCancel: () => void
  onConfirm: () => void
  show: boolean
  themed: boolean
  title: string
  variant?: 'primary' | 'danger'
}

export default function VisualTableConfirmationDialog({
  cancelLabel = 'Cancel',
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  show,
  themed,
  title,
  variant = 'primary',
}: Props) {
  return (
    <OLModal show={show} onHide={onCancel} themed={themed}>
      <OLModalHeader>
        <OLModalTitle>{title}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>{message}</OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </OLButton>
        <OLButton variant={variant} onClick={onConfirm}>
          {confirmLabel}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
