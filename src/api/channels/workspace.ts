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
    // When a profileId is supplied, load that profile's workspace without
    // binding to the connection's windowId. The host returns the profile's
    // live window state (current sdkSessionIds / running sessions) when one
    // exists, falling back to the persisted snapshot otherwise.
    load: (profileId?: string) =>
      ws.invokeParams<string | null>(
        'workspace:load',
        profileId ? { profileId } : contextParams(),
        profileId ? [undefined, undefined, profileId] : [undefined, ws.clientContext?.windowId],
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
