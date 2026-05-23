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

type ClaudeHistoryItem = ClaudeMessage | ClaudeToolCall

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeHistoryEvent(args: unknown[]): { sessionId: string; items: ClaudeHistoryItem[] } | null {
  const [first, second] = args
  if (typeof first === 'string') {
    const secondRecord = asRecord(second)
    const items = Array.isArray(second)
      ? second
      : Array.isArray(secondRecord?.items) ? secondRecord.items
        : Array.isArray(secondRecord?.payload) ? secondRecord.payload : []
    return { sessionId: first, items: items as ClaudeHistoryItem[] }
  }

  const payload = asRecord(first)
  if (typeof payload?.sessionId === 'string') {
    const items = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.payload) ? payload.payload : []
    return { sessionId: payload.sessionId, items: items as ClaudeHistoryItem[] }
  }

  return null
}

export function createClaudeChannel(ws: WebSocketClient) {
  return {
    // ---- Session Lifecycle ----
    startSession: (sessionId: string, options: {
      cwd: string
      prompt?: string
      sdkSessionId?: string
      permissionMode?: string
      model?: string
      effort?: string
      agentPreset?: string
      codexSandboxMode?: string
      codexApprovalPolicy?: string
    }) => ws.invokeParams('agent:start-session', { sessionId, options }, [sessionId, options]),

    sendMessage: (sessionId: string, prompt: string, images?: string[]) =>
      ws.invokeParams('agent:send-message', { sessionId, prompt, images }, [sessionId, prompt, images]),

    stopSession: (sessionId: string) =>
      ws.invokeParams<boolean>('agent:stop-session', { sessionId }, [sessionId]),

    abortSession: (sessionId: string) =>
      ws.invokeParams('agent:abort-session', { sessionId }, [sessionId]),

    resetSession: (sessionId: string) =>
      ws.invokeParams('agent:reset-session', { sessionId }, [sessionId]),

    resumeSession: (sessionId: string, sdkSessionId: string, cwd: string, model?: string, options?: {
      agentPreset?: string
      permissionMode?: string
      effort?: string
      codexSandboxMode?: string
      codexApprovalPolicy?: string
    }) =>
      ws.invokeParams(
        'agent:resume-session',
        {
          sessionId,
          sdkSessionId,
          options: {
            cwd,
            model,
            agentPreset: options?.agentPreset,
            codexSandboxMode: options?.codexSandboxMode,
            codexApprovalPolicy: options?.codexApprovalPolicy,
            permissionMode: options?.permissionMode,
            effort: options?.effort,
          },
        },
        [
          sessionId,
          sdkSessionId,
          cwd,
          model,
          undefined,
          undefined,
          undefined,
          undefined,
          options?.agentPreset,
          options?.codexSandboxMode,
          options?.codexApprovalPolicy,
          options?.permissionMode,
          options?.effort,
        ],
      ),

    forkSession: (sessionId: string) =>
      ws.invokeParams<string>('agent:fork-session', { sessionId }, [sessionId]),

    rewindToPrompt: (sessionId: string, promptIndex: number) =>
      ws.invoke('claude:rewind-to-prompt', sessionId, promptIndex),

    restSession: (sessionId: string) =>
      ws.invoke('claude:rest-session', sessionId),

    wakeSession: (sessionId: string) =>
      ws.invoke('claude:wake-session', sessionId),

    isResting: (sessionId: string) =>
      ws.invoke<boolean>('claude:is-resting', sessionId),

    listSessions: (cwd: string) =>
      ws.invoke<unknown[]>('claude:list-sessions', cwd),

    // ---- Settings ----
    setPermissionMode: (sessionId: string, mode: string) =>
      ws.invokeParams('agent:set-permission-mode', { sessionId, mode }, [sessionId, mode]),

    setCodexSandboxMode: (sessionId: string, mode: string) =>
      ws.invokeParams('agent:set-codex-sandbox-mode', { sessionId, mode }, [sessionId, mode]),

    setCodexApprovalPolicy: (sessionId: string, policy: string) =>
      ws.invokeParams('agent:set-codex-approval-policy', { sessionId, policy }, [sessionId, policy]),

    setModel: (sessionId: string, model: string) =>
      ws.invokeParams('agent:set-model', { sessionId, model }, [sessionId, model]),

    setEffort: (sessionId: string, effort: string) =>
      ws.invokeParams('agent:set-effort', { sessionId, effort }, [sessionId, effort]),

    setAutoContinue: (sessionId: string, opts: { enabled: boolean; max?: number; prompt?: string }) =>
      ws.invoke('claude:set-auto-continue', sessionId, opts),

    getAutoContinue: (sessionId: string) =>
      ws.invoke<{ enabled: boolean; max?: number; prompt?: string } | null>('claude:get-auto-continue', sessionId),

    // ---- Info ----
    getSupportedModels: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-models', { sessionId }, [sessionId]),

    getSupportedEfforts: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-efforts', { sessionId }, [sessionId]),

    getSupportedCodexSandboxModes: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-codex-sandbox-modes', { sessionId }, [sessionId]),

    getSupportedCodexApprovalPolicies: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-codex-approval-policies', { sessionId }, [sessionId]),

    getSupportedAgents: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-agents', { sessionId }, [sessionId]),

    getAccountInfo: (sessionId: string) =>
      ws.invoke('claude:get-account-info', sessionId),

    getSessionMeta: (sessionId: string) =>
      ws.invokeParams<SessionMeta>('agent:get-session-meta', { sessionId }, [sessionId]),

    getSupportedCommands: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-commands', { sessionId }, [sessionId]),

    getContextUsage: (sessionId: string) =>
      ws.invokeParams('agent:get-context-usage', { sessionId }, [sessionId]),

    getCliPath: () =>
      ws.invoke<string>('claude:get-cli-path'),

    // ---- Worktree ----
    getWorktreeStatus: (sessionId: string) =>
      ws.invokeParams('agent:get-worktree-status', { sessionId }, [sessionId]),

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

    onTurnEnd: (cb: (sessionId: string) => void) =>
      ws.on('claude:turn-end', cb as (...args: unknown[]) => void),

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
      ws.on('claude:history', (...args: unknown[]) => {
        const event = normalizeHistoryEvent(args)
        if (event) cb(event.sessionId, event.items)
      }),

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
