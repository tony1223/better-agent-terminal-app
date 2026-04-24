/**
 * Connection Store - manages WebSocket connection state
 * Supports TLS connections with certificate fingerprint pinning.
 */

import { create } from 'zustand'
import { WebSocketClient, type ConnectionStatus, type RemoteClientContext } from '@/api/websocket-client'
import { createChannels, type Channels } from '@/api/channels'
import { dlog } from '@/utils/debug-log'

interface ConnectionState {
  status: ConnectionStatus
  host: string | null
  port: number
  tls: boolean
  error: string | null
  client: WebSocketClient | null
  channels: Channels | null

  connect: (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null) => Promise<boolean>
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

  connect: async (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null) => {
    dlog('CONN', `store.connect(${host}, ${port}, token=${token.slice(0, 8)}..., fp=${fingerprint ? fingerprint.slice(0, 12) + '...' : 'none'})`)
    const { client: existing } = get()
    if (existing) {
      dlog('CONN', 'disconnecting existing client')
      existing.disconnect()
    }

    const client = new WebSocketClient()

    client.onStatusChange((status) => {
      dlog('CONN', `status changed: ${status}, error: ${client.error}`)
      set({
        status,
        error: client.error,
      })
    })

    set({ client, host, port, tls: !!fingerprint, status: 'connecting', error: null })

    try {
      const ok = await client.connect(host, port, token, 'BAT-Mobile', fingerprint, context)
      dlog('CONN', `client.connect returned: ${ok}`)

      if (ok) {
        const channels = createChannels(client)
        set({ channels, status: 'connected', error: null, tls: !!fingerprint })
        return true
      } else {
        dlog('CONN', `connect failed, error: ${client.error}`)
        set({ client: null, channels: null })
        return false
      }
    } catch (e) {
      dlog('CONN', `connect threw: ${e}`)
      set({ client: null, channels: null, status: 'error', error: String(e) })
      return false
    }
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
