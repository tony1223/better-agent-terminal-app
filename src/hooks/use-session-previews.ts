import { useCallback } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useConnectionStore } from '@/stores/connection-store'
import { watchSessionActivity } from '@/stores/session-activity-sync'
import {
  useSessionPreviewStore,
  PREVIEW_REFRESH_MS,
} from '@/stores/session-preview-store'

/** Only refresh while a session list is visible and its profile is ready. */
export function useSessionPreviews(sessionIds: string[]): void {
  const key = JSON.stringify(sessionIds)
  const channels = useConnectionStore(s =>
    s.status === 'connected' &&
    (s.profileStatus === 'ready' || !s.client?.supportsProfileContext)
      ? s.channels
      : null,
  )
  useFocusEffect(
    useCallback(() => {
      if (!channels) return
      const ids = JSON.parse(key) as string[]
      const stopActivity = watchSessionActivity(channels.claude, ids)
      let timer: ReturnType<typeof setTimeout> | undefined
      let disposed = false
      let refreshing = false
      let foreground =
        AppState.currentState !== 'background' &&
        AppState.currentState !== 'inactive'
      const refresh = async () => {
        if (timer) clearTimeout(timer)
        if (disposed || !foreground || refreshing) return
        refreshing = true
        await useSessionPreviewStore
          .getState()
          .load(ids, () => !disposed && foreground)
          .catch(() => undefined)
        refreshing = false
        if (!disposed && foreground)
          timer = setTimeout(refresh, PREVIEW_REFRESH_MS)
      }
      refresh()
      const listener = AppState.addEventListener('change', state => {
        foreground = state === 'active'
        if (timer) clearTimeout(timer)
        if (foreground) refresh()
      })
      return () => {
        disposed = true
        stopActivity()
        if (timer) clearTimeout(timer)
        listener.remove()
      }
    }, [channels, key]),
  )
}
