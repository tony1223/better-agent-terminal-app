import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { useClaudeStore } from '@/stores/claude-store'
import { isRemoteMethodNotFound } from '@/api/websocket-client'

export function useSessionReload(sessionId: string) {
  const { t } = useTranslation()
  const channels = useConnectionStore(s => s.channels)
  const connected = useConnectionStore(s => s.status === 'connected')
  const scope = useClaudeStore(s => s.scopeKey)
  const session = useClaudeStore(s => s.sessions[sessionId])
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const busy = session?.meta?.runtimeStatus === 'reloading'
  useEffect(() => {
    const lifecycle = generation
    ++lifecycle.current
    inFlight.current = false
    setPending(false)
    return () => { ++lifecycle.current }
  }, [sessionId, channels, scope])
  const reload = useCallback(async () => {
    if (inFlight.current || !connected || !channels
      || useConnectionStore.getState().channels !== channels || useClaudeStore.getState().scopeKey !== scope) return
    if (busy) { Alert.alert(t('reloadSession.title'), t('reloadSession.busy')); return }
    const current = generation.current
    const isCurrent = () => current === generation.current
      && useConnectionStore.getState().channels === channels
      && useClaudeStore.getState().scopeKey === scope
    inFlight.current = true
    setPending(true)
    try {
      const result = await channels.claude.reloadSession(sessionId)
      if (!isCurrent()) return
      if (!result || result.ok !== true || result.sessionId !== sessionId || typeof result.deferred !== 'boolean') {
        throw new Error(t('reloadSession.unavailable'))
      }
      // Shared status comes from the host broadcast. Never clear the transcript
      // or overwrite a newer turn/profile with a late reload acknowledgement.
      Alert.alert(t('reloadSession.title'), t(result.deferred ? 'reloadSession.nextTurn' : 'reloadSession.complete'))
    } catch (error) {
      if (isCurrent()) Alert.alert(t('reloadSession.failed'),
        error instanceof Error && isRemoteMethodNotFound(error) ? t('reloadSession.unavailable') : String(error))
    } finally {
      if (isCurrent()) { inFlight.current = false; setPending(false) }
    }
  }, [busy, channels, connected, scope, sessionId, t])
  return { reload, pending, disabled: pending || busy || !connected }
}
