import { useTranslation } from 'react-i18next'
import { formatDate, fromNowDate } from '@/utils/dates'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

type DateCellProps = {
  projectId: string
  actorName: string
  date?: string
}

export default function DateCell({
  projectId,
  actorName,
  date,
}: DateCellProps) {
  const { t } = useTranslation()
  const fromNow = date ? fromNowDate(date) : t('never')
  const tooltipText = date ? formatDate(date) : t('never')

  return (
    <OLTooltip
      key={`tooltip-date-${projectId}`}
      id={`tooltip-date-${projectId}`}
      description={tooltipText}
      overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
    >
      <span translate="no">
        {t('last_updated_date_by_x', {
          lastUpdatedDate: fromNow,
          person: actorName,
        })}
      </span>
    </OLTooltip>
  )
}
