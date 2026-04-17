/**
 * Core data models for BAT Mobile
 * Ported from BAT Desktop:
 *   src/types/index.ts
 *   src/types/claude-agent.ts
 *   src/types/agent-presets.ts
 */

// ============================================
//   Agent Presets
// ============================================

export type AgentPresetId = 'claude-code' | 'gemini-cli' | 'codex-cli' | 'copilot-cli' | 'none'

export interface AgentPreset {
  id: string
  name: string
  icon: string
  color: string
  command?: string
}

export const AGENT_PRESETS: AgentPreset[] = [
  { id: 'claude-code', name: 'Claude Code', icon: '\u2726', color: '#d97706', command: 'claude --continue' },
  { id: 'gemini-cli', name: 'Gemini CLI', icon: '\u25C7', color: '#4285f4', command: 'gemini' },
  { id: 'codex-cli', name: 'Codex', icon: '\u2B21', color: '#10a37f', command: 'codex' },
  { id: 'copilot-cli', name: 'GitHub Copilot', icon: '\u2B22', color: '#6e40c9', command: 'gh copilot' },
  { id: 'none', name: 'Terminal', icon: '\u2318', color: '#888888' },
]

export function getAgentPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find(p => p.id === id)
}

// ============================================
//   Environment Variables
// ============================================

export interface EnvVariable {
  key: string
  value: string
  enabled: boolean
}

// ============================================
//   Workspace
// ============================================

export interface Workspace {
  id: string
  name: string
  alias?: string
  folderPath: string
  createdAt: number
  defaultAgent?: AgentPresetId
  envVars?: EnvVariable[]
  group?: string
  lastSdkSessionId?: string
}

// ============================================
//   Terminal Instance
// ============================================

export interface TerminalInstance {
  id: string
  workspaceId: string
  type: 'terminal'
  agentPreset?: AgentPresetId
  title: string
  alias?: string
  pid?: number
  cwd: string
  scrollbackBuffer: string[]
  lastActivityTime?: number
  hasPendingAction?: boolean
  sdkSessionId?: string
  model?: string
  pendingPrompt?: string
  pendingImages?: string[]
}

// ============================================
//   App State (workspace:load response)
// ============================================

export interface AppState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  terminals: TerminalInstance[]
  activeTerminalId: string | null
  focusedTerminalId: string | null
}

// ============================================
//   PTY Types
// ============================================

export interface CreatePtyOptions {
  id: string
  cwd: string
  type: 'terminal'
  agentPreset?: AgentPresetId
  shell?: string
  customEnv?: Record<string, string>
}

export interface PtyOutput {
  id: string
  data: string
}

export interface PtyExit {
  id: string
  exitCode: number
}

// ============================================
//   Claude Agent Types
// ============================================

export interface ClaudeMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  parentToolUseId?: string
  timestamp: number
}

export interface ClaudeToolCall {
  id: string
  sessionId: string
  toolName: string
  input: Record<string, unknown>
  status: 'running' | 'completed' | 'error'
  result?: string
  description?: string
  denyReason?: string
  denied?: boolean
  parentToolUseId?: string
  timestamp: number
}

export function isToolCall(item: ClaudeMessage | ClaudeToolCall): item is ClaudeToolCall {
  return 'toolName' in item
}

// ============================================
//   Claude Session Meta
// ============================================

export interface SessionMeta {
  model?: string
  sdkSessionId?: string
  cwd?: string
  totalCost: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  numTurns: number
  contextWindow: number
  permissionMode?: string
}

// ============================================
//   Claude Permission & Ask User
// ============================================

export interface PermissionRequest {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  suggestions?: unknown[]
  decisionReason?: string
}

export interface PermissionResult {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?: string
}

export interface AskUserQuestion {
  question: string
  header: string
  options: Array<{ label: string; description: string; markdown?: string }>
  multiSelect: boolean
}

export interface AskUserRequest {
  toolUseId: string
  questions: AskUserQuestion[]
}

// ============================================
//   Claude Stream Data
// ============================================

export interface ClaudeStreamData {
  text?: string
  thinking?: string
  parentToolUseId?: string
}

// ============================================
//   Claude Result
// ============================================

export interface ClaudeResult {
  subtype?: string
  totalCost?: number
  totalTokens?: number
  result?: unknown
  errors?: string[]
}

// ============================================
//   Saved Host (for mobile host management)
// ============================================

export interface SavedHost {
  id: string
  name: string
  address: string
  port: number
  fingerprint?: string
  useTLS?: boolean
}

// ============================================
//   Profile
// ============================================

export interface ProfileEntry {
  id: string
  name: string
  type?: 'local' | 'remote'
}

// ============================================
//   Color Presets (from BAT Desktop)
// ============================================

export const COLOR_PRESETS = [
  { id: 'novel', name: 'Novel (Default)', background: '#1f1d1a', foreground: '#dfdbc3', cursor: '#dfdbc3' },
  { id: 'dracula', name: 'Dracula', background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2' },
  { id: 'monokai', name: 'Monokai', background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f2' },
  { id: 'solarized-dark', name: 'Solarized Dark', background: '#002b36', foreground: '#839496', cursor: '#839496' },
  { id: 'nord', name: 'Nord', background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9' },
  { id: 'one-dark', name: 'One Dark', background: '#282c34', foreground: '#abb2bf', cursor: '#abb2bf' },
] as const

export type ColorPresetId = typeof COLOR_PRESETS[number]['id']
