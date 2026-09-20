import { useConnectionStore } from './connection-store'
import { useClaudeStore } from './claude-store'

/** App-wide, not tied to the visible conversation. Defer until synchronous
 * profile activation finishes, and require the exact original server/scope. */
export function subscribeMessageReconnectRetry(): () => void {
  let disposed = false
  let scheduled = false
  const schedule = () => {
    if (scheduled || disposed) return
    scheduled = true
    void Promise.resolve().then(() => {
      scheduled = false
      if (disposed) return
      const connection = useConnectionStore.getState()
      const { client, channels, host, port } = connection
      if (connection.status !== 'connected' || !client || client.isConnected === false || !channels || !host) return
      if (client.supportsProfileContext && (connection.profileStatus !== 'ready' || !connection.profileContext)) return
      const scope = client.supportsProfileContext
        ? `${client.profileCacheKey ?? `${host}:${port}`}/${connection.profileContext!.bindingKey}`
        : `${host}:${port}/legacy`
      const store = useClaudeStore.getState()
      if (store.scopeKey !== scope) return
      for (const [sessionId, session] of Object.entries(store.sessions)) {
        for (const message of session.messages) {
          if ('toolName' in message || message.role !== 'user' || message.status !== 'failed'
            || message.reconnectRetry !== 'pending' || !message.sendPayload) continue
          const current = useConnectionStore.getState()
          if (useClaudeStore.getState().scopeKey !== scope || current.channels !== channels
            || current.status !== 'connected' || current.client?.isConnected === false
            || (current.client?.supportsProfileContext && current.profileStatus !== 'ready')) return
          store.retryUserMessage(sessionId, message.id, true)
        }
      }
    })
  }
  const unsubscribeConnection = useConnectionStore.subscribe(schedule)
  const unsubscribeMessages = useClaudeStore.subscribe(schedule)
  schedule()
  return () => { disposed = true; unsubscribeConnection(); unsubscribeMessages() }
}
