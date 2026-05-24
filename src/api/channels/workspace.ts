/**
 * Workspace Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createWorkspaceChannel(ws: WebSocketClient) {
  const contextParams = () => (
    ws.clientContext?.windowId ? { windowId: ws.clientContext.windowId } : {}
  )

  return {
    save: (data: string) =>
      ws.invokeParams<boolean>(
        'workspace:save',
        { ...contextParams(), data },
        [undefined, data, ws.clientContext?.windowId],
      ),
    load: () =>
      ws.invokeParams<string | null>(
        'workspace:load',
        contextParams(),
        [undefined, ws.clientContext?.windowId],
      ),

    // Events
    onDetached: (cb: (workspaceId: string) => void) =>
      ws.on('workspace:detached', cb as (...args: unknown[]) => void),
    onReattached: (cb: (workspaceId: string) => void) =>
      ws.on('workspace:reattached', cb as (...args: unknown[]) => void),
    onReload: (cb: (payload: unknown) => void) =>
      ws.on('workspace:reload', cb as (...args: unknown[]) => void),
  }
}

export type WorkspaceChannel = ReturnType<typeof createWorkspaceChannel>
