/**
 * App / host channel: version + remote-driven host self-update.
 *
 * These map to the desktop host's Tauri updater (commands/update.rs), exposed
 * over the remote protocol so a paired client can update + relaunch the host.
 * Older hosts that predate these channels reject the invoke — callers should
 * surface that as "host too old to update remotely".
 */

import type { WebSocketClient } from '../websocket-client'

export interface HostUpdateCheck {
  available: boolean
  currentVersion: string
  version?: string
  notes?: string
  channel?: string
}

export interface HostUpdateInstall {
  installed: boolean
  version?: string
  reason?: string
}

// Downloading the bundle can take a while on the host; give install a generous
// ceiling well above the default invoke timeout.
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000

export function createAppChannel(ws: WebSocketClient) {
  return {
    getVersion: () =>
      ws.invokeParams<{ version: string; protocol?: string }>('app:get-version', {}),
    checkUpdate: (channel: string = 'stable') =>
      ws.invokeParams<HostUpdateCheck>('app:check-update', { channel }),
    installUpdate: (channel: string = 'stable') =>
      ws.invokeParams<HostUpdateInstall>('app:install-update', { channel }, [], {
        timeoutMs: INSTALL_TIMEOUT_MS,
      }),
    relaunch: () =>
      ws.invokeParams<{ ok: boolean }>('app:relaunch', {}),
  }
}

export type AppChannel = ReturnType<typeof createAppChannel>
