/**
 * Connection Store - manages WebSocket connection state
 * Supports TLS connections with certificate fingerprint pinning.
 */

import { AppState } from 'react-native'
import { create } from 'zustand'
import { WebSocketClient, type ChannelTransport, type ConnectionStatus, type RemoteClientContext } from '@/api/websocket-client'
import { createChannels, type Channels } from '@/api/channels'
import { dlog } from '@/utils/debug-log'
import { getRemoteClientIdentity } from '@/utils/client-identity'
import { activateProfileScope } from './profile-scope'

export interface ProfileContext {
  contextId: string
  profileId: string
  name: string
  bindingKey: string
  status: 'ready' | 'unavailable'
}

let selectionVersion = 0
let profileStatusUnsubscribe: (() => void) | null = null
const unavailableTransport: ChannelTransport = {
  invoke: () => Promise.reject(new Error('Profile is not ready')),
  invokeParams: () => Promise.reject(new Error('Profile is not ready')),
  on: () => () => {},
}

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
  profileContext: ProfileContext | null
  profileViewKey: string | null
  selectedProfileId: string | null
  selectedProfileName: string | null
  profileStatus: 'idle' | 'loading' | 'ready' | 'unavailable'
  selectProfile: (profileId: string, force?: boolean) => Promise<Channels>

  connect: (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null, useTLS?: boolean) => Promise<boolean>
  checkConnection: () => Promise<boolean>
  /** Retry now instead of waiting out the backoff (the reconnect banner). */
  retryNow: () => void
  disconnect: () => void
}

/** The connected server, independent of the currently selected profile. */
export function workspaceShortcutServerKey(state: Pick<ConnectionState, 'host' | 'port' | 'client'>): string | null {
  return state.host ? (state.client?.profileCacheKey ?? `${state.host}:${state.port}`) : null
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
  profileContext: null,
  profileViewKey: null,
  selectedProfileId: null,
  selectedProfileName: null,
  profileStatus: 'idle',

  selectProfile: async (profileId, force = false) => {
    const { client, channels, profileContext } = get()
    if (!client || !channels) throw new Error('Not connected to host')
    if (!client.supportsProfileContext) return channels
    if (!force && profileContext?.profileId === profileId && get().profileStatus === 'ready') return channels
    const version = ++selectionVersion
    profileStatusUnsubscribe?.()
    profileStatusUnsubscribe = null
    set({ selectedProfileId: profileId, profileContext: null, profileStatus: 'loading', channels: createChannels(unavailableTransport, client) })
    if (profileContext) client.invokeParams('profile:close', { contextId: profileContext.contextId }).catch(() => {})
    try {
      const context = await client.invokeParams<ProfileContext>('profile:open', { profileId })
      if (version !== selectionVersion || get().client !== client) {
        client.invokeParams('profile:close', { contextId: context.contextId }).catch(() => {})
        throw new Error('Profile selection changed')
      }
      if (!context.contextId || context.profileId !== profileId || context.status !== 'ready') throw new Error('Profile unavailable')
      const scoped = client.scoped(context.contextId)
      const isCurrent = () => get().profileContext?.contextId === context.contextId && get().client === client
      const guard = async <T,>(operation: () => Promise<T>): Promise<T> => {
        if (!isCurrent()) throw new Error('Profile selection changed')
        try {
          const result = await operation()
          if (!isCurrent()) throw new Error('Profile selection changed')
          return result
        } catch (error) {
          if (isCurrent() && /profile context|unknown profile|profile changed or was removed|profile unavailable/i.test(String(error))) {
            set({ profileStatus: 'unavailable' })
          }
          throw error
        }
      }
      const transport: ChannelTransport = {
        invoke: (channel, ...args) => guard(() => scoped.invoke(channel, ...args)),
        invokeParams: (channel, params, args, opts) => guard(() => scoped.invokeParams(channel, params, args, opts)),
        on: (channel, cb) => scoped.on(channel, (...args) => { if (isCurrent()) cb(...args) }),
      }
      const nextChannels = createChannels(transport, client)
      activateProfileScope(`${client.profileCacheKey ?? `${get().host}:${get().port}`}/${context.bindingKey}`)
      profileStatusUnsubscribe = scoped.on('profile:status', (payload: any) => {
        if (!isCurrent()) return
        if (payload?.status === 'unavailable') set({ profileStatus: 'unavailable' })
      })
      set({ profileContext: context, profileViewKey: context.bindingKey, selectedProfileName: context.name, profileStatus: 'ready', channels: nextChannels })
      return nextChannels
    } catch (error) {
      if (version === selectionVersion && get().client === client) set({ profileStatus: 'unavailable' })
      throw error
    }
  },

  connect: async (host: string, port: number, token: string, fingerprint?: string | null, context?: RemoteClientContext | null, useTLS?: boolean) => {
    selectionVersion++
    profileStatusUnsubscribe?.()
    const tls = useTLS ?? !!fingerprint
    dlog('!CONN', `store.connect(${host}, ${port}, token=${token.slice(0, 8)}..., tls=${tls}, fp=${fingerprint ? fingerprint.slice(0, 12) + '...' : 'none'})`)
    const { client: existing } = get()
    if (existing) {
      dlog('CONN', 'disconnecting existing client')
      existing.disconnect()
    }

    const client = new WebSocketClient()

    client.onStatusChange((status) => {
      if (get().client !== client) return
      dlog(status === 'error' ? '!CONN' : 'CONN', `status changed: ${status}, error: ${client.error}`)
      // A reconnect reuses this client, and only the initial connect below
      // builds the channels — so a session that comes back after the first
      // attempt failed would otherwise be connected with nothing wired up.
      const channels = status === 'connected' && (!get().channels || (client.supportsProfileContext && !get().profileContext))
        ? createChannels(client.supportsProfileContext ? unavailableTransport : client, client)
        : get().channels
      const ended = (status === 'disconnected' || status === 'error') && !client.willRetry
      set({
        status,
        error: client.error,
        channels: ended ? null : channels,
        ...(ended ? { sessionActive: false } : {}),
        ...(status !== 'connected' ? { profileContext: null, profileStatus: 'idle' as const } : {}),
      })
    })

    set({ client, host, port, tls, status: 'connecting', error: null, channels: null, profileContext: null, profileViewKey: null, selectedProfileId: null, selectedProfileName: null, profileStatus: 'idle' })

    try {
      const identity = getRemoteClientIdentity()
      const clientContext = {
        ...(context ?? {}),
        clientInfo: identity,
      }
      const ok = await client.connect(host, port, token, identity.label, fingerprint, clientContext, tls)
      if (get().client !== client) return false
      dlog(ok ? 'CONN' : '!CONN', `client.connect returned: ${ok}`)

      if (ok) {
        if (!client.supportsProfileContext) activateProfileScope(`${host}:${port}/legacy`)
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
    const profileId = get().selectedProfileId
    if (client.isConnected && profileId && client.supportsProfileContext) {
      get().selectProfile(profileId, true).catch(() => {})
      return
    }
    dlog('CONN', 'manual retry requested')
    client.resume()
  },

  disconnect: () => {
    selectionVersion++
    profileStatusUnsubscribe?.()
    profileStatusUnsubscribe = null
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
      profileContext: null,
      selectedProfileId: null,
      selectedProfileName: null,
      profileViewKey: null,
      profileStatus: 'idle',
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
    dlog('CONN', 'app foregrounded — checking connection freshness')
    client.resume()
  }
})
