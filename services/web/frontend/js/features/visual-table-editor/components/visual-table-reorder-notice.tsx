import DSNotification from '@/shared/components/ds/ds-notification'

type Props = {
  message: string
}

export default function VisualTableReorderNotice({ message }: Props) {
  return (
    <DSNotification
      className="vte-reorder-notice"
      content={message}
      type="error"
    />
  )
}
