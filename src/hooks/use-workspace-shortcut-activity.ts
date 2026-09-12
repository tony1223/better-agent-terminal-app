import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useConnectionStore } from '@/stores/connection-store'
import {
  subscribeWorkspaceShortcutActivity,
  type WorkspaceActivitySummary,
  type WorkspaceActivityTarget,
} from '@/stores/workspace-shortcut-activity'

export function useWorkspaceShortcutActivity(targets: WorkspaceActivityTarget[]) {
  const channels = useConnectionStore(s => s.channels)
  const status = useConnectionStore(s => s.status)
  const targetsKey = JSON.stringify(targets.map(({ profileId, workspaceId }) => ({ profileId, workspaceId })))
  const [snapshot, setSnapshot] = useState<{
    owner: typeof channels
    summaries: Record<string, WorkspaceActivitySummary>
  }>({ owner: null, summaries: {} })
  const subscription = useRef<ReturnType<typeof subscribeWorkspaceShortcutActivity> | null>(null)

  useFocusEffect(useCallback(() => {
    if (status !== 'connected' || !channels) return
    const current = subscribeWorkspaceShortcutActivity(JSON.parse(targetsKey), (key, summary) => {
      setSnapshot(previous => ({
        owner: channels,
        summaries: { ...(previous.owner === channels ? previous.summaries : {}), [key]: summary },
      }))
    })
    subscription.current = current
    return () => { current.dispose(); subscription.current = null }
  }, [channels, status, targetsKey]))

  return {
    summaries: snapshot.owner === channels && status === 'connected' ? snapshot.summaries : {},
    refresh: useCallback(() => subscription.current?.refresh() ?? Promise.resolve(), []),
  }
}
