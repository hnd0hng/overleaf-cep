import { useTranslation } from 'react-i18next'
import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'
import { useCallback, useMemo } from 'react'
import DropdownSetting from '../dropdown-setting'
import { useEditorAnalytics } from '@/shared/hooks/use-editor-analytics'

type CompileMode = 'normal' | 'fast_draft' | 'quick_preview'

export default function DraftSetting() {
  const { draft, quickPreview, setDraft, setQuickPreview } = useCompileContext()
  const { t } = useTranslation()
  const { sendEvent } = useEditorAnalytics()

  let mode: CompileMode = 'normal'
  if (draft) mode = 'fast_draft'
  if (quickPreview) mode = 'quick_preview'

  const changeMode = useCallback(
    (value: CompileMode) => {
      sendEvent('recompile-setting-changed', {
        setting: 'compile-mode',
        settingVal: value,
      })
      setDraft(value !== 'normal')
      setQuickPreview(value === 'quick_preview')
    },
    [sendEvent, setDraft, setQuickPreview]
  )

  const options = useMemo(
    () => [
      { label: t('normal'), value: 'normal' as const },
      { label: t('fast_draft'), value: 'fast_draft' as const },
      { label: t('quick_preview'), value: 'quick_preview' as const },
    ],
    [t]
  )

  return (
    <DropdownSetting
      id="draft"
      label={t('compile_mode')}
      options={options}
      description={t('switch_compile_mode_for_faster_draft_compilation')}
      value={mode}
      onChange={changeMode}
      width="default"
    />
  )
}
