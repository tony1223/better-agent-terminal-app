/**
 * Connection Store - manages WebSocket connection state
 */

import { create } from 'zustand'
import { WebSocketClient, type ConnectionStatus } from '@/api/websocket-client'
import { createChannels, type Channels } from '@/api/channels'
import { dlog } from '@/utils/debug-log'

interface ConnectionState {
  status: ConnectionStatus
  host: string | null
  port: number
  error: string | null
  client: WebSocketClient | null
  channels: Channels | null

  connect: (host: string, port: number, token: string) => Promise<boolean>
  disconnect: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  host: null,
  port: 0,
  error: null,
  client: null,
  channels: null,

  connect: async (host: string, port: number, token: string) => {
    dlog('CONN', `store.connect(${host}, ${port}, token=${token.slice(0, 8)}...)`)
    // Disconnect existing connection
    const { client: existing } = get()
    if (existing) {
      dlog('CONN', 'disconnecting existing client')
      existing.disconnect()
    }

    const client = new WebSocketClient()

    // Subscribe to status changes
    client.onStatusChange((status) => {
      dlog('CONN', `status changed: ${status}, error: ${client.error}`)
      set({
        status,
        error: client.error,
      })
    })

    set({ client, host, port, status: 'connecting', error: null })

    try {
      const ok = await client.connect(host, port, token, 'BAT-Mobile')
      dlog('CONN', `client.connect returned: ${ok}`)

      if (ok) {
        const channels = createChannels(client)
        set({ channels, status: 'connected', error: null })
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
      error: null,
    })
  },
}))
