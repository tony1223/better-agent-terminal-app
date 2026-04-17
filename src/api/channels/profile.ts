/**
 * Profile Channel Proxy
 * Synced with BAT Desktop protocol.
 */

import type { WebSocketClient } from '../websocket-client'
import type { ProfileEntry } from '@/types'

export function createProfileChannel(ws: WebSocketClient) {
  return {
    list: () =>
      ws.invoke<{ profiles: ProfileEntry[]; activeProfileId: string }>('profile:list'),
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
  }
}

export type ProfileChannel = ReturnType<typeof createProfileChannel>
