/**
 * Worktree Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

// worktree:create / merge / remove / rehydrate are slow git mutations on the
// host; the protocol gives them a long invoke timeout (desktop uses 120s).
// worktree:status stays on the short default so a stalled host fails fast.
const MUTATION_TIMEOUT = { timeoutMs: 120_000 }

export function createWorktreeChannel(ws: WebSocketClient) {
  return {
    create: (sessionId: string, cwd: string, installPnpm = false) =>
      ws.invokeParams('worktree:create', { sessionId, cwd, installPnpm }, [sessionId, cwd, installPnpm], MUTATION_TIMEOUT),
    remove: (sessionId: string, deleteBranch = true) =>
      ws.invokeParams('worktree:remove', { sessionId, deleteBranch }, [sessionId, deleteBranch], MUTATION_TIMEOUT),
    status: (sessionId: string) =>
      ws.invokeParams('worktree:status', { sessionId }, [sessionId]),
    merge: (sessionId: string, strategy: string) =>
      ws.invokeParams('worktree:merge', { sessionId, strategy }, [sessionId, strategy], MUTATION_TIMEOUT),
    rehydrate: (sessionId: string, cwd: string, worktreePath: string, branchName: string) =>
      ws.invokeParams('worktree:rehydrate', { sessionId, cwd, worktreePath, branchName }, [sessionId, cwd, worktreePath, branchName], MUTATION_TIMEOUT),
  }
}

export type WorktreeChannel = ReturnType<typeof createWorktreeChannel>
