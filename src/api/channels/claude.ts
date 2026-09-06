/**
 * Claude Agent Channel Proxy
 * Synced with BAT Desktop protocol.
 */

import type { ChannelTransport as WebSocketClient } from '../websocket-client'
import type {
  ClaudeMessage,
  ClaudeToolCall,
  ClaudeStreamData,
  ClaudeResult,
  SessionMeta,
  SessionStateSnapshot,
  PermissionRequest,
  PermissionResult,
  AskUserRequest,
} from '@/types'

type ClaudeHistoryItem = ClaudeMessage | ClaudeToolCall

export interface CodexAccountEntry {
  /** Account entry id; pass this to codexAccountSwitch (named codexHome on the wire). */
  id: string
  label?: string
  email?: string | null
  accountId?: string | null
  codexHome?: string
  authenticated?: boolean
  active?: boolean
  isDefault?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export interface ResumeOptions {
  agentPreset?: string
  permissionMode?: string
  effort?: string
  autoCompactWindow?: number | null
  codexSandboxMode?: string
  codexApprovalPolicy?: string
  useWorktree?: boolean
  worktreePath?: string
  worktreeBranch?: string
}

/**
 * `agent:resume-session` and `agent:client-resume` take identical params — the
 * host decodes both through the same builder — so the two differ only in what
 * they do to a session that is already live.
 */
function resumeArgs(
  sessionId: string,
  sdkSessionId: string,
  cwd: string,
  model?: string,
  options?: ResumeOptions,
) {
  return {
    named: {
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
        // number = enforce; null = explicitly uncapped; undefined = let
        // the host derive it from the model preset id.
        ...(typeof options?.autoCompactWindow === 'number' || options?.autoCompactWindow === null
          ? { autoCompactWindow: options.autoCompactWindow }
          : {}),
        ...(options?.useWorktree
          ? {
            useWorktree: true,
            worktreePath: options.worktreePath,
            worktreeBranch: options.worktreeBranch,
          }
          : {}),
      },
    },
    positional: [
      sessionId,
      sdkSessionId,
      cwd,
      model,
      undefined,
      options?.useWorktree ? true : undefined,
      options?.worktreePath,
      options?.worktreeBranch,
      options?.agentPreset,
      options?.codexSandboxMode,
      options?.codexApprovalPolicy,
      options?.permissionMode,
      options?.effort,
    ],
  }
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
      // Worktree sessions must pass these so the host sidecar validates the
      // (host-side) worktree folder and fails loudly when it is missing
      // instead of silently running unisolated in the original cwd.
      useWorktree?: boolean
      worktreePath?: string
      worktreeBranch?: string
    }) => ws.invokeParams('agent:start-session', { sessionId, options }, [sessionId, options]),

    sendMessage: (sessionId: string, prompt: string, images?: string[]) =>
      ws.invokeParams('agent:send-message', { sessionId, prompt, images }, [sessionId, prompt, images]),

    stopSession: (sessionId: string) =>
      ws.invokeParams<boolean>('agent:stop-session', { sessionId }, [sessionId]),

    abortSession: (sessionId: string) =>
      ws.invokeParams('agent:abort-session', { sessionId }, [sessionId]),

    resetSession: (sessionId: string) =>
      ws.invokeParams('agent:reset-session', { sessionId }, [sessionId]),

    /**
     * Restart the SDK session from a transcript. Tears down whatever the host
     * has live, so it aborts an in-flight turn — only use it when the intent is
     * genuinely to restart, not merely to look at the conversation.
     */
    resumeSession: (sessionId: string, sdkSessionId: string, cwd: string, model?: string, options?: ResumeOptions) => {
      const { named, positional } = resumeArgs(sessionId, sdkSessionId, cwd, model, options)
      return ws.invokeParams('agent:resume-session', named, positional)
    },

    /**
     * What a client that just wants to *view* a session should call.
     *
     * When the host has the session live it re-emits the persisted transcript
     * over `claude:history`, read-only, without disturbing a running turn; when
     * the session is absent it falls back to a full resume. Either way history
     * arrives, which `resumeSession` cannot promise: against a live session it
     * answers `alreadyLive: true` and emits nothing, and `getSessionState` then
     * reports the host's *empty in-memory buffer* — so the view renders blank.
     */
    clientResume: (sessionId: string, sdkSessionId: string, cwd: string, model?: string, options?: ResumeOptions) => {
      const { named, positional } = resumeArgs(sessionId, sdkSessionId, cwd, model, options)
      return ws.invokeParams('agent:client-resume', named, positional)
    },

    forkSession: (sessionId: string) =>
      ws.invokeParams<string>('agent:fork-session', { sessionId }, [sessionId]),

    rewindToPrompt: (sessionId: string, promptIndex: number) =>
      ws.invokeParams('agent:rewind-to-prompt', { sessionId, promptIndex }, [sessionId, promptIndex]),

    restSession: (sessionId: string) =>
      ws.invokeParams('agent:rest-session', { sessionId }, [sessionId]),

    wakeSession: (sessionId: string) =>
      ws.invokeParams('agent:wake-session', { sessionId }, [sessionId]),

    isResting: (sessionId: string) =>
      ws.invokeParams<boolean>('agent:is-resting', { sessionId }, [sessionId]),

    listSessions: (cwd: string, agentKind?: 'claude' | 'codex') =>
      ws.invokeParams<unknown[]>(
        'agent:list-sessions',
        agentKind ? { cwd, agentKind } : { cwd },
        agentKind ? [cwd, agentKind] : [cwd],
      ),

    // ---- Settings ----
    setPermissionMode: (sessionId: string, mode: string) =>
      ws.invokeParams('agent:set-permission-mode', { sessionId, mode }, [sessionId, mode]),

    setCodexSandboxMode: (sessionId: string, mode: string) =>
      ws.invokeParams('agent:set-codex-sandbox-mode', { sessionId, mode }, [sessionId, mode]),

    setCodexApprovalPolicy: (sessionId: string, policy: string) =>
      ws.invokeParams('agent:set-codex-approval-policy', { sessionId, policy }, [sessionId, policy]),

    // A numeric autoCompactWindow makes the host rebuild the query, which is
    // also where auto-compact preset ids get mapped back to real SDK model
    // ids — without it the host hands the raw string to the live session.
    setModel: (sessionId: string, model: string, autoCompactWindow?: number | null) =>
      ws.invokeParams(
        'agent:set-model',
        { sessionId, model, ...(typeof autoCompactWindow === 'number' || autoCompactWindow === null ? { autoCompactWindow } : {}) },
        [sessionId, model, autoCompactWindow],
      ),

    setEffort: (sessionId: string, effort: string) =>
      ws.invokeParams('agent:set-effort', { sessionId, effort }, [sessionId, effort]),

    setAutoContinue: (sessionId: string, opts: { enabled: boolean; max?: number; prompt?: string }) =>
      ws.invokeParams('agent:set-auto-continue', { sessionId, opts }, [sessionId, opts]),

    getAutoContinue: (sessionId: string) =>
      ws.invokeParams<{ enabled: boolean; max?: number; prompt?: string } | null>('agent:get-auto-continue', { sessionId }, [sessionId]),

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
      ws.invokeParams('agent:get-account-info', { sessionId }, [sessionId]),

    getSessionMeta: (sessionId: string) =>
      ws.invokeParams<SessionMeta>('agent:get-session-meta', { sessionId }, [sessionId]),

    getSessionState: (sessionId: string) =>
      ws.invokeParams<SessionStateSnapshot | null>('agent:get-session-state', { sessionId }, [sessionId]),

    getSupportedCommands: (sessionId: string) =>
      ws.invokeParams<unknown[]>('agent:get-supported-commands', { sessionId }, [sessionId]),

    /**
     * This session's *context* breakdown (what is filling the window), not
     * account quota. The 5h/7d figures come from the `agent:usage` broadcast —
     * reading them off this result silently yields undefined, which is how the
     * quota chips went missing.
     */
    getContextUsage: (sessionId: string) =>
      ws.invokeParams('agent:get-context-usage', { sessionId }, [sessionId]),

    getCliPath: () =>
      ws.invokeParams<string>('agent:get-cli-path', {}, []),

    // ---- Worktree ----
    getWorktreeStatus: (sessionId: string) =>
      ws.invokeParams('agent:get-worktree-status', { sessionId }, [sessionId]),

    cleanupWorktree: (sessionId: string) =>
      ws.invokeParams('agent:cleanup-worktree', { sessionId }, [sessionId]),

    // ---- Permissions & Interaction ----
    resolvePermission: (sessionId: string, toolUseId: string, result: PermissionResult) =>
      ws.invokeParams('agent:resolve-permission', { sessionId, toolUseId, result }, [sessionId, toolUseId, result]),

    resolveAskUser: (sessionId: string, toolUseId: string, answers: Record<string, string>) =>
      ws.invokeParams('agent:resolve-ask-user', { sessionId, toolUseId, answers }, [sessionId, toolUseId, answers]),

    stopTask: (sessionId: string, taskId: string) =>
      ws.invokeParams('agent:stop-task', { sessionId, taskId }, [sessionId, taskId]),

    // ---- Archive ----
    archiveMessages: (sessionId: string, messages: unknown[]) =>
      ws.invokeParams('agent:archive-messages', { sessionId, messages }, [sessionId, messages]),

    loadArchived: (sessionId: string, offset = 0, limit = 300) =>
      ws.invokeParams<{ messages: unknown[]; total: number; hasMore: boolean }>('agent:load-archived', { sessionId, offset, limit }, [sessionId, offset, limit]),

    clearArchive: (sessionId: string) =>
      ws.invokeParams('agent:clear-archive', { sessionId }, [sessionId]),

    fetchSubagentMessages: (sessionId: string, subagentId: string) =>
      ws.invokeParams('agent:fetch-subagent-messages', { sessionId, subagentId }, [sessionId, subagentId]),

    // ---- Skills ----
    scanSkills: (sessionId: string) =>
      ws.invokeParams('agent:scan-skills', { sessionId }, [sessionId]),

    // ---- Auth ----
    authLogin: () => ws.invokeParams('agent:auth-login', {}, []),
    authStatus: () => ws.invokeParams('agent:auth-status', {}, []),
    authLogout: () => ws.invokeParams('agent:auth-logout', {}, []),

    // ---- Account ----
    accountList: () => ws.invokeParams('agent:account-list', {}, []),
    accountImportCurrent: () => ws.invokeParams('agent:account-import-current', {}, []),
    accountLoginNew: () => ws.invokeParams('agent:account-login-new', {}, []),
    accountSwitch: (accountId: string) => ws.invokeParams('agent:account-switch', { accountId }, [accountId]),
    accountRemove: (accountId: string) => ws.invokeParams('agent:account-remove', { accountId }, [accountId]),
    accountMarkWarningShown: (accountId: string) => ws.invokeParams('agent:account-mark-warning-shown', { accountId }, [accountId]),

    // ---- Codex accounts (host-owned, mirrors the Claude account channels) ----
    codexAccountList: () =>
      ws.invokeParams<{ accounts?: CodexAccountEntry[]; activeCodexHome?: string | null }>('codex:account-list', {}, []),
    codexAccountSwitch: (codexHome: string) =>
      ws.invokeParams('codex:account-switch', { codexHome }, [codexHome]),

    // ---- Events ----
    onMessage: (cb: (sessionId: string, msg: ClaudeMessage) => void) =>
      ws.on('agent:message', cb as (...args: unknown[]) => void),

    onToolUse: (cb: (sessionId: string, tool: ClaudeToolCall) => void) =>
      ws.on('agent:tool-use', cb as (...args: unknown[]) => void),

    onToolResult: (cb: (sessionId: string, result: { id: string; status: string; result?: string; description?: string }) => void) =>
      ws.on('agent:tool-result', cb as (...args: unknown[]) => void),

    onStream: (cb: (sessionId: string, data: ClaudeStreamData) => void) =>
      ws.on('agent:stream', cb as (...args: unknown[]) => void),

    onResult: (cb: (sessionId: string, result: ClaudeResult) => void) =>
      ws.on('agent:result', cb as (...args: unknown[]) => void),

    onTurnEnd: (cb: (sessionId: string) => void) =>
      ws.on('agent:turn-end', cb as (...args: unknown[]) => void),

    onError: (cb: (sessionId: string, error: string) => void) =>
      ws.on('agent:error', cb as (...args: unknown[]) => void),

    onStatus: (cb: (sessionId: string, meta: SessionMeta) => void) =>
      ws.on('agent:status', cb as (...args: unknown[]) => void),

    onPermissionRequest: (cb: (sessionId: string, data: PermissionRequest) => void) =>
      ws.on('agent:permission-request', cb as (...args: unknown[]) => void),

    onPermissionResolved: (cb: (sessionId: string, toolUseId: string) => void) =>
      ws.on('agent:permission-resolved', cb as (...args: unknown[]) => void),

    onAskUser: (cb: (sessionId: string, data: AskUserRequest) => void) =>
      ws.on('agent:ask-user', cb as (...args: unknown[]) => void),

    onAskUserResolved: (cb: (sessionId: string, toolUseId: string) => void) =>
      ws.on('agent:ask-user-resolved', cb as (...args: unknown[]) => void),

    onModeChange: (cb: (sessionId: string, mode: string) => void) =>
      ws.on('agent:modeChange', cb as (...args: unknown[]) => void),

    onHistory: (cb: (sessionId: string, items: (ClaudeMessage | ClaudeToolCall)[]) => void) =>
      ws.on('agent:history', (...args: unknown[]) => {
        const event = normalizeHistoryEvent(args)
        if (event) cb(event.sessionId, event.items)
      }),

    onPromptSuggestion: (cb: (sessionId: string, suggestion: string) => void) =>
      ws.on('agent:prompt-suggestion', cb as (...args: unknown[]) => void),

    onSessionReset: (cb: (sessionId: string) => void) =>
      ws.on('agent:session-reset', cb as (...args: unknown[]) => void),

    onWorktreeInfo: (cb: (sessionId: string, info: unknown) => void) =>
      ws.on('agent:worktree-info', cb as (...args: unknown[]) => void),

    onRateLimit: (cb: (sessionId: string, data: unknown) => void) =>
      ws.on('agent:rate-limit', cb as (...args: unknown[]) => void),
    /** Host-wide 5h/7d quota, broadcast every ~150s. */
    onUsage: (cb: (snapshot: unknown) => void) =>
      ws.on('agent:usage', cb as (...args: unknown[]) => void),
    /**
     * The last snapshot the host published, per provider — so a client that
     * connects between ticks doesn't sit blank for up to 150s.
     *
     * Hosts before this channel existed answer method-not-found; callers are
     * expected to shrug and wait for the next broadcast.
     */
    getUsageSnapshot: () =>
      ws.invokeParams<Record<string, unknown>>('agent:usage-snapshot', {}, []),
  }
}

export type ClaudeChannel = ReturnType<typeof createClaudeChannel>
