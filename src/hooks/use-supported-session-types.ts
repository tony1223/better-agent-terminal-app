import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useConnectionStore } from '@/stores/connection-store'
import { normalizeAgentPresetsFromHost, type AgentPreset } from '@/types'

function isReady(state: ReturnType<typeof useConnectionStore.getState>): boolean {
  return state.status === 'connected' && !!state.channels &&
    (!state.client?.supportsProfileContext || state.profileStatus === 'ready')
}

function isTransientError(error: unknown): boolean {
  return error instanceof Error &&
    /not connected to remote server|profile is not ready|profile (selection|connection) changed|connection closed|^disconnected$/i.test(error.message)
}

export function useSupportedSessionTypes(errorTitle: string) {
  const channels = useConnectionStore(s => s.channels)
  const ready = useConnectionStore(isReady)
  const [availableSessionTypes, setAvailableSessionTypes] = useState<AgentPreset[] | null>(null)
  const [loadingTypes, setLoadingTypes] = useState(false)
  const requestVersion = useRef(0)

  const loadSupportedSessionTypes = useCallback(async () => {
    if (!ready || !channels || !isReady(useConnectionStore.getState()) ||
      useConnectionStore.getState().channels !== channels) return

    const version = ++requestVersion.current
    const isCurrent = () => version === requestVersion.current &&
      useConnectionStore.getState().channels === channels && isReady(useConnectionStore.getState())
    setLoadingTypes(true)
    try {
      const presets = await channels.agent.listPresets()
        .then(normalizeAgentPresetsFromHost)
        .catch(error => {
          // Older hosts may only support the session-type IDs endpoint.
          // Reconnection errors must not trigger another call on the old channel.
          if (isTransientError(error)) throw error
          return []
        })
      if (!isCurrent()) return
      const types = presets.length > 0
        ? presets
        : normalizeAgentPresetsFromHost(await channels.agent.getSupportedSessionTypes())
      if (isCurrent()) setAvailableSessionTypes(types)
    } catch (error) {
      if (!isCurrent() || isTransientError(error)) return
      setAvailableSessionTypes([])
      Alert.alert(errorTitle, String(error))
    } finally {
      if (version === requestVersion.current) setLoadingTypes(false)
    }
  }, [channels, ready, errorTitle])

  useEffect(() => {
    const requests = requestVersion
    // A connected socket can still be opening its profile after a reconnect.
    // Readiness/channel changes retry automatically and invalidate old requests.
    if (ready) loadSupportedSessionTypes()
    else setLoadingTypes(false)
    return () => { requests.current++ }
  }, [ready, loadSupportedSessionTypes])

  return { availableSessionTypes, loadingTypes, loadSupportedSessionTypes }
}
