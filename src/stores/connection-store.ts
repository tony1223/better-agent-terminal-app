/**
 * Connection Store - manages WebSocket connection state
 * Supports TLS connections with certificate fingerprint pinning.
 */

import { AppState } from 'react-native'
import { create } from 'zustand'
import { WebSocketClient, type ConnectionStatus, type RemoteClientContext } from '@/api/websocket-client'
import { createChannels, type Channels } from '@/api/channels'
import { dlog } from '@/utils/debug-log'
import { getRemoteClientIdentity } from '@/utils/client-identity'

interface ConnectionState {
  status: ConnectionStatus
  host: string | null
  port: number
  tls: boolean
  error: string | null
  client: WebSocketClient | null
  channels: Channels | null
  /**
   * True from the first successful auth until the session really ends — an
   * explicit disconnect, a rejected token, a changed certificate. A drop that
   * the client is retrying keeps this true so the app stays where the user
   * left it instead of throwing them back to the host list.
   */
  sessionActive: boolean

  connect: (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null, useTLS?: boolean) => Promise<boolean>
  checkConnection: () => Promise<boolean>
  /** Retry now instead of waiting out the backoff (the reconnect banner). */
  retryNow: () => void
  disconnect: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  host: null,
  port: 0,
  tls: false,
  error: null,
  client: null,
  channels: null,
  sessionActive: false,

  connect: async (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null, useTLS?: boolean) => {
    const tls = useTLS ?? !!fingerprint
    dlog('!CONN', `store.connect(${host}, ${port}, token=${token.slice(0, 8)}..., tls=${tls}, fp=${fingerprint ? fingerprint.slice(0, 12) + '...' : 'none'})`)
    const { client: existing } = get()
    if (existing) {
      dlog('CONN', 'disconnecting existing client')
      existing.disconnect()
    }

    const client = new WebSocketClient()

    client.onStatusChange((status) => {
      dlog(status === 'error' ? '!CONN' : 'CONN', `status changed: ${status}, error: ${client.error}`)
      // A reconnect reuses this client, and only the initial connect below
      // builds the channels — so a session that comes back after the first
      // attempt failed would otherwise be connected with nothing wired up.
      const channels = status === 'connected' && !get().channels
        ? createChannels(client)
        : get().channels
      const ended = (status === 'disconnected' || status === 'error') && !client.willRetry
      set({
        status,
        error: client.error,
        channels: ended ? null : channels,
        ...(ended ? { sessionActive: false } : {}),
      })
    })

    set({ client, host, port, tls, status: 'connecting', error: null })

    try {
      const identity = getRemoteClientIdentity()
      const clientContext = {
        ...(context ?? {}),
        clientInfo: identity,
      }
      const ok = await client.connect(host, port, token, identity.label, fingerprint, clientContext, tls)
      dlog(ok ? 'CONN' : '!CONN', `client.connect returned: ${ok}`)

      if (ok) {
        const channels = get().channels ?? createChannels(client)
        set({ channels, status: 'connected', error: null, tls, sessionActive: true })
        return true
      } else {
        dlog('!CONN', `connect failed, error: ${client.error}`)
        set({ client: null, channels: null, sessionActive: false })
        return false
      }
    } catch (e) {
      dlog('!CONN', `connect threw: ${e}`)
      set({ client: null, channels: null, status: 'error', error: String(e), sessionActive: false })
      return false
    }
  },

  checkConnection: async () => {
    const { client, status } = get()
    if (!client) {
      dlog('!CONN', 'health check skipped: no client')
      set({ status: 'disconnected', channels: null, error: null })
      return false
    }
    if (status !== 'connected') {
      dlog('CONN', `health check skipped: status=${status}`)
      return false
    }

    const ok = await client.checkConnection()
    dlog(ok ? 'CONN' : '!CONN', `health check result: ${ok}`)
    return ok
  },

  retryNow: () => {
    const { client } = get()
    if (!client) return
    dlog('CONN', 'manual retry requested')
    client.resume()
  },

  disconnect: () => {
    const { client } = get()
    if (client) {
      client.disconnect()
    }
    set({
      client: null,
      channels: null,
      status: 'disconnected',
      host: null,
      port: 0,
      tls: false,
      error: null,
      sessionActive: false,
    })
  },
}))

// Background suspension freezes JS timers and the OS kills idle sockets, so
// when the app comes back to the foreground the connection may be dead while
// the status still says 'connected' — or a reconnect attempt may be parked on
// a stale backoff timer. Kick the client immediately on every foreground.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') return
  const { client } = useConnectionStore.getState()
  if (client) {
    dlog('CONN', 'app foregrounded — probing connection')
    client.resume()
  }
})
