import { useCallback, useEffect, useRef, useState } from 'react'

export type TransientNotice = {
  id: number
  message: string
}

export const REORDER_NOTICE_DURATION = 2500

export default function useTransientNotice(duration = REORDER_NOTICE_DURATION) {
  const [notice, setNotice] = useState<TransientNotice | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const idRef = useRef(0)

  const showNotice = useCallback(
    (message: string) => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
      setNotice({ id: ++idRef.current, message })
      timerRef.current = window.setTimeout(() => {
        setNotice(null)
        timerRef.current = undefined
      }, duration)
    },
    [duration]
  )

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
    },
    []
  )

  return { notice, showNotice }
}
