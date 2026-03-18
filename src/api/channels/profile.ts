/**
 * Profile Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'
import type { ProfileEntry } from '@/types'

export function createProfileChannel(ws: WebSocketClient) {
  return {
    list: () =>
      ws.invoke<{ profiles: ProfileEntry[]; activeProfileId: string }>('profile:list'),
    load: (profileId: string) =>
      ws.invoke('profile:load', profileId),
    getActiveId: () =>
      ws.invoke<string>('profile:get-active-id'),
    setActive: (profileId: string) =>
      ws.invoke('profile:set-active', profileId),
  }
}

export type ProfileChannel = ReturnType<typeof createProfileChannel>
