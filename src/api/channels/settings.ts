/**
 * Settings Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createSettingsChannel(ws: WebSocketClient) {
  return {
    save: (data: string) =>
      ws.invoke<boolean>('settings:save', data),
    load: () =>
      ws.invoke<string | null>('settings:load'),
    getShellPath: (shell: string) =>
      ws.invoke<string>('settings:get-shell-path', shell),
  }
}

export type SettingsChannel = ReturnType<typeof createSettingsChannel>
