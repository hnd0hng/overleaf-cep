import classNames from 'classnames'
import MaterialIcon from '@/shared/components/material-icon'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

type Props = {
  active?: boolean
  className?: string
  disabled?: boolean
  icon: string
  label: string
  onClick: () => void
  tooltipId: string
}

export default function VisualTableToolbarButton({
  active,
  className,
  disabled,
  icon,
  label,
  onClick,
  tooltipId,
}: Props) {
  return (
    <OLTooltip
      id={tooltipId}
      description={label}
      overlayProps={{ placement: 'bottom' }}
    >
      <span className="vte-toolbar-button-wrapper">
        <OLIconButton
          accessibilityLabel={label}
          aria-pressed={active === undefined ? undefined : active}
          className={classNames('vte-toolbar-button', className, {
            active,
          })}
          disabled={disabled}
          icon={icon}
          onClick={onClick}
          size="sm"
          type="button"
          variant="secondary"
        />
      </span>
    </OLTooltip>
  )
}

type ColorPickerProps = {
  icon: string
  label: string
  onChange: (value: string) => void
  tooltipId: string
}

export function VisualTableColorPicker({
  icon,
  label,
  onChange,
  tooltipId,
}: ColorPickerProps) {
  return (
    <OLTooltip
      id={tooltipId}
      description={label}
      overlayProps={{ placement: 'bottom' }}
    >
      <label className="vte-color-control">
        <MaterialIcon type={icon} />
        <input
          aria-label={label}
          type="color"
          onChange={event => onChange(event.target.value)}
        />
      </label>
    </OLTooltip>
  )
}
