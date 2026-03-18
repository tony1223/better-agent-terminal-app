/**
 * Claude Agent Channel Proxy
 * Reference: BAT Desktop electron/preload.ts (claude section)
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
    // ---- Invoke Methods ----
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

    setPermissionMode: (sessionId: string, mode: string) =>
      ws.invoke('claude:set-permission-mode', sessionId, mode),

    setModel: (sessionId: string, model: string) =>
      ws.invoke('claude:set-model', sessionId, model),

    setEffort: (sessionId: string, effort: string) =>
      ws.invoke('claude:set-effort', sessionId, effort),

    set1MContext: (sessionId: string, enable: boolean) =>
      ws.invoke('claude:set-1m-context', sessionId, enable),

    resetSession: (sessionId: string) =>
      ws.invoke('claude:reset-session', sessionId),

    getSupportedModels: (sessionId: string) =>
      ws.invoke<string[]>('claude:get-supported-models', sessionId),

    getAccountInfo: (sessionId: string) =>
      ws.invoke('claude:get-account-info', sessionId),

    getSessionMeta: (sessionId: string) =>
      ws.invoke<SessionMeta>('claude:get-session-meta', sessionId),

    getSupportedCommands: (sessionId: string) =>
      ws.invoke('claude:get-supported-commands', sessionId),

    resolvePermission: (sessionId: string, toolUseId: string, result: PermissionResult) =>
      ws.invoke('claude:resolve-permission', sessionId, toolUseId, result),

    resolveAskUser: (sessionId: string, toolUseId: string, answers: Record<string, string>) =>
      ws.invoke('claude:resolve-ask-user', sessionId, toolUseId, answers),

    listSessions: (sessionId: string) =>
      ws.invoke('claude:list-sessions', sessionId),

    resumeSession: (sessionId: string, sdkSessionId: string, cwd: string, model?: string) =>
      ws.invoke('claude:resume-session', sessionId, sdkSessionId, cwd, model),

    forkSession: (sessionId: string) =>
      ws.invoke<string>('claude:fork-session', sessionId),

    stopTask: (sessionId: string, taskId: string) =>
      ws.invoke('claude:stop-task', sessionId, taskId),

    restSession: (sessionId: string) =>
      ws.invoke('claude:rest-session', sessionId),

    wakeSession: (sessionId: string) =>
      ws.invoke('claude:wake-session', sessionId),

    isResting: (sessionId: string) =>
      ws.invoke<boolean>('claude:is-resting', sessionId),

    archiveMessages: (sessionId: string, messages: unknown[]) =>
      ws.invoke('claude:archive-messages', sessionId, messages),

    loadArchived: (sessionId: string) =>
      ws.invoke('claude:load-archived', sessionId),

    clearArchive: (sessionId: string) =>
      ws.invoke('claude:clear-archive', sessionId),

    getUsage: () =>
      ws.invoke('claude:get-usage'),

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

    onAskUser: (cb: (sessionId: string, data: AskUserRequest) => void) =>
      ws.on('claude:ask-user', cb as (...args: unknown[]) => void),

    onModeChange: (cb: (sessionId: string, mode: string) => void) =>
      ws.on('claude:modeChange', cb as (...args: unknown[]) => void),

    onHistory: (cb: (sessionId: string, items: (ClaudeMessage | ClaudeToolCall)[]) => void) =>
      ws.on('claude:history', cb as (...args: unknown[]) => void),

    onPromptSuggestion: (cb: (sessionId: string, suggestion: string) => void) =>
      ws.on('claude:prompt-suggestion', cb as (...args: unknown[]) => void),
  }
}

export type ClaudeChannel = ReturnType<typeof createClaudeChannel>
