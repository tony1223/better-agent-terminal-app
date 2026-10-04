import { useCallback, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'

/** Keep completion badges expiring even if no new host events arrive. */
export function useActivityClock() {
  const [now, setNow] = useState(Date.now)
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const update = (active: boolean) => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      if (!active) return
      setNow(Date.now())
      timer = setInterval(() => setNow(Date.now()), 15000)
    }
    update(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
    const listener = AppState.addEventListener('change', state => update(state === 'active'))
    return () => { if (timer !== undefined) clearInterval(timer); listener.remove() }
  }, []))
  return Math.max(now, Date.now())
}
