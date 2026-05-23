/**
 * Profile Channel Proxy
 * Synced with BAT Desktop protocol.
 */

import type { WebSocketClient } from '../websocket-client'
import type { ProfileEntry } from '@/types'

export interface ProfileListResult {
  profiles: ProfileEntry[]
  activeProfileId?: string | null
  activeProfileIds?: string[]
}

export type ProfileChangedPayload = ProfileListResult

export function createProfileChannel(ws: WebSocketClient) {
  return {
    list: () =>
      ws.invoke<ProfileListResult>('profile:list'),
    load: (profileId: string) =>
      ws.invoke('profile:load', profileId),
    loadSnapshot: (profileId: string) =>
      ws.invoke('profile:load-snapshot', profileId),
    getActiveIds: () =>
      ws.invoke<string[]>('profile:get-active-ids'),
    activate: (profileId: string) =>
      ws.invoke('profile:activate', profileId),
    deactivate: (profileId: string) =>
      ws.invoke('profile:deactivate', profileId),

    // Events
    onChanged: (cb: (payload: ProfileChangedPayload) => void) =>
      ws.on('profile:changed', cb as (...args: unknown[]) => void),
  }
}

export type ProfileChannel = ReturnType<typeof createProfileChannel>
