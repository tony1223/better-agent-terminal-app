/**
 * Worktree Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createWorktreeChannel(ws: WebSocketClient) {
  return {
    create: (sessionId: string, cwd: string, installPnpm = false) =>
      ws.invokeParams('worktree:create', { sessionId, cwd, installPnpm }, [sessionId, cwd, installPnpm]),
    remove: (sessionId: string, deleteBranch = true) =>
      ws.invokeParams('worktree:remove', { sessionId, deleteBranch }, [sessionId, deleteBranch]),
    status: (sessionId: string) =>
      ws.invokeParams('worktree:status', { sessionId }, [sessionId]),
    merge: (sessionId: string, strategy: string) =>
      ws.invokeParams('worktree:merge', { sessionId, strategy }, [sessionId, strategy]),
    rehydrate: (sessionId: string, cwd: string, worktreePath: string, branchName: string) =>
      ws.invokeParams('worktree:rehydrate', { sessionId, cwd, worktreePath, branchName }, [sessionId, cwd, worktreePath, branchName]),
  }
}

export type WorktreeChannel = ReturnType<typeof createWorktreeChannel>
