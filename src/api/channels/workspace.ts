/**
 * Workspace Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createWorkspaceChannel(ws: WebSocketClient) {
  return {
    save: (data: string) =>
      ws.invoke<boolean>('workspace:save', data),
    load: () =>
      ws.invoke<string | null>('workspace:load'),

    // Events
    onDetached: (cb: (workspaceId: string) => void) =>
      ws.on('workspace:detached', cb as (...args: unknown[]) => void),
    onReattached: (cb: (workspaceId: string) => void) =>
      ws.on('workspace:reattached', cb as (...args: unknown[]) => void),
  }
}

export type WorkspaceChannel = ReturnType<typeof createWorkspaceChannel>
