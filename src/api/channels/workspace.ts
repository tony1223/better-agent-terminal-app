/**
 * Workspace Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createWorkspaceChannel(ws: WebSocketClient) {
  // Per the v2 protocol, clients SHOULD omit windowId entirely on
  // workspace:load/workspace:save. Client-side window ids never name a host
  // registry entry: validated hosts ignore them, and pre-validation hosts
  // fabricate an empty phantom registry entry from the unknown id on
  // workspace:load — serving an empty list on every reconnect while the
  // previously saved data stays stranded under the phantom entry. Omitting
  // windowId routes both load and save through the host's profile-level
  // snapshot, the host-owned source of truth.
  return {
    // When a profileId is supplied, save targets that profile's snapshot
    // directly; otherwise the host falls back to its default profile.
    save: (data: string, profileId?: string) =>
      ws.invokeParams<boolean>(
        'workspace:save',
        { ...(profileId ? { profileId } : {}), data },
        [undefined, data, profileId],
      ),
    // When a profileId is supplied, load that profile's workspace. The host
    // returns the profile's live window state (current sdkSessionIds /
    // running sessions) when one exists, falling back to the persisted
    // snapshot otherwise.
    load: (profileId?: string) =>
      ws.invokeParams<string | null>(
        'workspace:load',
        profileId ? { profileId } : {},
        profileId ? [undefined, undefined, profileId] : [undefined],
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
