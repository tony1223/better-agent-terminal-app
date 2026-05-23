/**
 * BAT WebSocket Protocol Types
 * Synced with BAT Desktop remote WebSocket protocol.
 *
 * V2 uses named `params` and canonical remote agent channels under `agent:*`.
 * Legacy v1 uses positional `args`.
 */

export type RemoteFrameType =
  | 'invoke'
  | 'invoke-result'
  | 'invoke-error'
  | 'event'
  | 'auth'
  | 'auth-result'
  | 'ping'
  | 'pong'

export interface RemoteFrame {
  type: RemoteFrameType
  id: string
  channel?: string
  args?: unknown[]
  params?: unknown
  protocols?: string[]
  protocol?: string
  compression?: string | string[]
  result?: unknown
  error?: string
  token?: string
}

export const REMOTE_PROTOCOL_V2 = 'bat-remote/v2'
export const REMOTE_PROTOCOL_LEGACY_V1 = 'bat-remote/legacy-v1'
export const REMOTE_COMPRESSION_GZIP = 'gzip'
export const REMOTE_COMPRESSION_NONE = 'none'

// Channels proxied to remote host (client can invoke)
export const PROXIED_CHANNELS = new Set([
  // App metadata
  'app:get-version',
  // Agent runtime (v2 canonical namespace)
  'agent:start-session', 'agent:resume-session', 'agent:send-message',
  'agent:stop-session', 'agent:abort-session', 'agent:reset-session',
  'agent:set-model', 'agent:set-effort', 'agent:set-permission-mode',
  'agent:set-codex-sandbox-mode', 'agent:set-codex-approval-policy',
  'agent:get-supported-models', 'agent:get-supported-efforts',
  'agent:get-supported-codex-sandbox-modes',
  'agent:get-supported-codex-approval-policies',
  'agent:get-supported-commands', 'agent:get-supported-agents',
  'agent:get-session-state', 'agent:get-session-meta',
  'agent:get-context-usage', 'agent:get-worktree-status',
  'agent:fork-session', 'agent:list-sessions',
  // PTY
  'pty:create', 'pty:write', 'pty:read-buffer', 'pty:resize',
  'pty:get-viewport-state', 'pty:set-viewport-mode', 'pty:set-viewport-size',
  'pty:kill', 'pty:restart', 'pty:get-cwd',
  // Claude
  'claude:start-session', 'claude:send-message', 'claude:stop-session', 'claude:abort-session',
  'claude:set-permission-mode', 'claude:set-codex-sandbox-mode', 'claude:set-codex-approval-policy', 'claude:set-model', 'claude:set-effort', 'claude:reset-session',
  'claude:set-auto-continue', 'claude:get-auto-continue',
  'claude:get-supported-models', 'claude:get-account-info', 'claude:get-supported-commands', 'claude:get-supported-agents', 'claude:get-session-meta',
  'claude:get-worktree-status', 'claude:cleanup-worktree',
  'claude:resolve-permission', 'claude:resolve-ask-user',
  'claude:list-sessions', 'claude:resume-session', 'claude:fork-session', 'claude:rewind-to-prompt', 'claude:stop-task', 'claude:rest-session',
  'claude:wake-session', 'claude:is-resting',
  'claude:archive-messages', 'claude:load-archived', 'claude:clear-archive', 'claude:fetch-subagent-messages',
  'claude:scan-skills', 'claude:get-context-usage',
  'claude:auth-login', 'claude:auth-status', 'claude:auth-logout',
  'claude:account-list', 'claude:account-import-current', 'claude:account-login-new',
  'claude:account-switch', 'claude:account-remove', 'claude:account-mark-warning-shown',
  'claude:get-cli-path',
  // Standalone worktree operations
  'worktree:create', 'worktree:remove', 'worktree:status', 'worktree:merge', 'worktree:rehydrate',
  // Workspace
  'workspace:save', 'workspace:load',
  // Settings
  'settings:save', 'settings:load', 'settings:get-shell-path',
  // GitHub
  'github:check-cli', 'github:pr-list', 'github:issue-list', 'github:pr-view', 'github:issue-view',
  'github:pr-comment', 'github:issue-comment',
  // Git
  'git:branch', 'git:log', 'git:diff', 'git:diff-files', 'git:status', 'git:get-github-url', 'git:getRoot',
  // FS
  'fs:readdir', 'fs:readFile', 'fs:search', 'fs:watch', 'fs:unwatch',
  'fs:home', 'fs:list-dirs', 'fs:mkdir', 'fs:quick-locations',
  'image:read-as-data-url',
  // OpenAI direct agent settings
  'openai:list-sessions', 'openai:get-api-key-status', 'openai:set-api-key',
  'openai:clear-api-key', 'openai:compact-now',
  // Snippet
  'snippet:getAll', 'snippet:getById', 'snippet:create', 'snippet:update',
  'snippet:delete', 'snippet:toggleFavorite', 'snippet:search',
  'snippet:getCategories', 'snippet:getFavorites', 'snippet:getByWorkspace',
  // Profile
  'profile:list', 'profile:load', 'profile:load-snapshot', 'profile:get-active-ids', 'profile:activate', 'profile:deactivate',
])

// Events pushed from host to remote clients
export const PROXIED_EVENTS = new Set([
  'pty:output', 'pty:exit', 'pty:viewport-state',
  'agent:message', 'agent:tool-use', 'agent:tool-result',
  'agent:stream', 'agent:result', 'agent:turn-end', 'agent:error',
  'agent:status', 'agent:permission-request', 'agent:permission-resolved',
  'agent:ask-user', 'agent:ask-user-resolved', 'agent:modeChange',
  'agent:history', 'agent:resume-loading', 'agent:prompt-suggestion',
  'agent:session-reset', 'agent:worktree-info', 'agent:rate-limit',
  'claude:message', 'claude:tool-use', 'claude:tool-result',
  'claude:stream', 'claude:result', 'claude:turn-end', 'claude:error',
  'claude:status', 'claude:permission-request', 'claude:permission-resolved', 'claude:ask-user', 'claude:ask-user-resolved',
  'claude:modeChange', 'claude:history', 'claude:prompt-suggestion', 'claude:session-reset', 'claude:worktree-info', 'claude:rate-limit',
  'fs:changed',
  'profile:changed',
  'workspace:detached', 'workspace:reattached', 'workspace:reload',
  'system:resume',
])
