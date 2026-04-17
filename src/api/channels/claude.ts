/**
 * Claude Agent Channel Proxy
 * Synced with BAT Desktop protocol.
 */

import type { WebSocketClient } from '../websocket-client'
import type {
  ClaudeMessage,
  ClaudeToolCall,
  ClaudeStreamData,
  ClaudeResult,
  SessionMeta,
  PermissionRequest,
  PermissionResult,
  AskUserRequest,
} from '@/types'

export function createClaudeChannel(ws: WebSocketClient) {
  return {
    // ---- Session Lifecycle ----
    startSession: (sessionId: string, options: {
      cwd: string
      prompt?: string
      sdkSessionId?: string
      permissionMode?: string
      model?: string
    }) => ws.invoke('claude:start-session', sessionId, options),

    sendMessage: (sessionId: string, prompt: string, images?: string[]) =>
      ws.invoke('claude:send-message', sessionId, prompt, images),

    stopSession: (sessionId: string) =>
      ws.invoke<boolean>('claude:stop-session', sessionId),

    abortSession: (sessionId: string) =>
      ws.invoke('claude:abort-session', sessionId),

    resetSession: (sessionId: string) =>
      ws.invoke('claude:reset-session', sessionId),

    resumeSession: (sessionId: string, sdkSessionId: string, cwd: string, model?: string) =>
      ws.invoke('claude:resume-session', sessionId, sdkSessionId, cwd, model),

    forkSession: (sessionId: string) =>
      ws.invoke<string>('claude:fork-session', sessionId),

    restSession: (sessionId: string) =>
      ws.invoke('claude:rest-session', sessionId),

    wakeSession: (sessionId: string) =>
      ws.invoke('claude:wake-session', sessionId),

    isResting: (sessionId: string) =>
      ws.invoke<boolean>('claude:is-resting', sessionId),

    listSessions: (cwd: string) =>
      ws.invoke('claude:list-sessions', cwd),

    // ---- Settings ----
    setPermissionMode: (sessionId: string, mode: string) =>
      ws.invoke('claude:set-permission-mode', sessionId, mode),

    setModel: (sessionId: string, model: string) =>
      ws.invoke('claude:set-model', sessionId, model),

    setEffort: (sessionId: string, effort: string) =>
      ws.invoke('claude:set-effort', sessionId, effort),

    // ---- Info ----
    getSupportedModels: (sessionId: string) =>
      ws.invoke<string[]>('claude:get-supported-models', sessionId),

    getSupportedAgents: (sessionId: string) =>
      ws.invoke('claude:get-supported-agents', sessionId),

    getAccountInfo: (sessionId: string) =>
      ws.invoke('claude:get-account-info', sessionId),

    getSessionMeta: (sessionId: string) =>
      ws.invoke<SessionMeta>('claude:get-session-meta', sessionId),

    getSupportedCommands: (sessionId: string) =>
      ws.invoke('claude:get-supported-commands', sessionId),

    getContextUsage: (sessionId: string) =>
      ws.invoke('claude:get-context-usage', sessionId),

    getCliPath: () =>
      ws.invoke<string>('claude:get-cli-path'),

    // ---- Worktree ----
    getWorktreeStatus: (sessionId: string) =>
      ws.invoke('claude:get-worktree-status', sessionId),

    cleanupWorktree: (sessionId: string) =>
      ws.invoke('claude:cleanup-worktree', sessionId),

    // ---- Permissions & Interaction ----
    resolvePermission: (sessionId: string, toolUseId: string, result: PermissionResult) =>
      ws.invoke('claude:resolve-permission', sessionId, toolUseId, result),

    resolveAskUser: (sessionId: string, toolUseId: string, answers: Record<string, string>) =>
      ws.invoke('claude:resolve-ask-user', sessionId, toolUseId, answers),

    stopTask: (sessionId: string, taskId: string) =>
      ws.invoke('claude:stop-task', sessionId, taskId),

    // ---- Archive ----
    archiveMessages: (sessionId: string, messages: unknown[]) =>
      ws.invoke('claude:archive-messages', sessionId, messages),

    loadArchived: (sessionId: string) =>
      ws.invoke('claude:load-archived', sessionId),

    clearArchive: (sessionId: string) =>
      ws.invoke('claude:clear-archive', sessionId),

    fetchSubagentMessages: (sessionId: string, subagentId: string) =>
      ws.invoke('claude:fetch-subagent-messages', sessionId, subagentId),

    // ---- Skills ----
    scanSkills: (sessionId: string) =>
      ws.invoke('claude:scan-skills', sessionId),

    // ---- Auth ----
    authLogin: () => ws.invoke('claude:auth-login'),
    authStatus: () => ws.invoke('claude:auth-status'),
    authLogout: () => ws.invoke('claude:auth-logout'),

    // ---- Account ----
    accountList: () => ws.invoke('claude:account-list'),
    accountImportCurrent: () => ws.invoke('claude:account-import-current'),
    accountLoginNew: () => ws.invoke('claude:account-login-new'),
    accountSwitch: (accountId: string) => ws.invoke('claude:account-switch', accountId),
    accountRemove: (accountId: string) => ws.invoke('claude:account-remove', accountId),
    accountMarkWarningShown: (accountId: string) => ws.invoke('claude:account-mark-warning-shown', accountId),

    // ---- Events ----
    onMessage: (cb: (sessionId: string, msg: ClaudeMessage) => void) =>
      ws.on('claude:message', cb as (...args: unknown[]) => void),

    onToolUse: (cb: (sessionId: string, tool: ClaudeToolCall) => void) =>
      ws.on('claude:tool-use', cb as (...args: unknown[]) => void),

    onToolResult: (cb: (sessionId: string, result: { id: string; status: string; result?: string; description?: string }) => void) =>
      ws.on('claude:tool-result', cb as (...args: unknown[]) => void),

    onStream: (cb: (sessionId: string, data: ClaudeStreamData) => void) =>
      ws.on('claude:stream', cb as (...args: unknown[]) => void),

    onResult: (cb: (sessionId: string, result: ClaudeResult) => void) =>
      ws.on('claude:result', cb as (...args: unknown[]) => void),

    onError: (cb: (sessionId: string, error: string) => void) =>
      ws.on('claude:error', cb as (...args: unknown[]) => void),

    onStatus: (cb: (sessionId: string, meta: SessionMeta) => void) =>
      ws.on('claude:status', cb as (...args: unknown[]) => void),

    onPermissionRequest: (cb: (sessionId: string, data: PermissionRequest) => void) =>
      ws.on('claude:permission-request', cb as (...args: unknown[]) => void),

    onPermissionResolved: (cb: (sessionId: string, toolUseId: string) => void) =>
      ws.on('claude:permission-resolved', cb as (...args: unknown[]) => void),

    onAskUser: (cb: (sessionId: string, data: AskUserRequest) => void) =>
      ws.on('claude:ask-user', cb as (...args: unknown[]) => void),

    onAskUserResolved: (cb: (sessionId: string, toolUseId: string) => void) =>
      ws.on('claude:ask-user-resolved', cb as (...args: unknown[]) => void),

    onModeChange: (cb: (sessionId: string, mode: string) => void) =>
      ws.on('claude:modeChange', cb as (...args: unknown[]) => void),

    onHistory: (cb: (sessionId: string, items: (ClaudeMessage | ClaudeToolCall)[]) => void) =>
      ws.on('claude:history', cb as (...args: unknown[]) => void),

    onPromptSuggestion: (cb: (sessionId: string, suggestion: string) => void) =>
      ws.on('claude:prompt-suggestion', cb as (...args: unknown[]) => void),

    onSessionReset: (cb: (sessionId: string) => void) =>
      ws.on('claude:session-reset', cb as (...args: unknown[]) => void),

    onWorktreeInfo: (cb: (sessionId: string, info: unknown) => void) =>
      ws.on('claude:worktree-info', cb as (...args: unknown[]) => void),

    onRateLimit: (cb: (sessionId: string, data: unknown) => void) =>
      ws.on('claude:rate-limit', cb as (...args: unknown[]) => void),
  }
}

export type ClaudeChannel = ReturnType<typeof createClaudeChannel>
