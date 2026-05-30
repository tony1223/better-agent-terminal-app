/**
 * Connection Store - manages WebSocket connection state
 * Supports TLS connections with certificate fingerprint pinning.
 */

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

  connect: (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null, useTLS?: boolean) => Promise<boolean>
  checkConnection: () => Promise<boolean>
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
      set({
        status,
        error: client.error,
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
        const channels = createChannels(client)
        set({ channels, status: 'connected', error: null, tls })
        return true
      } else {
        dlog('!CONN', `connect failed, error: ${client.error}`)
        set({ client: null, channels: null })
        return false
      }
    } catch (e) {
      dlog('!CONN', `connect threw: ${e}`)
      set({ client: null, channels: null, status: 'error', error: String(e) })
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
    })
  },
}))
