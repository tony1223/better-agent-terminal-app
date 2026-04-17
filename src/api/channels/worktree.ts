/**
 * Worktree Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createWorktreeChannel(ws: WebSocketClient) {
  return {
    create: (cwd: string, branch: string) => ws.invoke('worktree:create', cwd, branch),
    remove: (worktreePath: string) => ws.invoke('worktree:remove', worktreePath),
    status: (cwd: string) => ws.invoke('worktree:status', cwd),
    merge: (worktreePath: string) => ws.invoke('worktree:merge', worktreePath),
    rehydrate: (worktreePath: string) => ws.invoke('worktree:rehydrate', worktreePath),
  }
}

export type WorktreeChannel = ReturnType<typeof createWorktreeChannel>
