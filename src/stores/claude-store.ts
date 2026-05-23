/**
 * Claude Store - manages Claude agent sessions, messages, streaming, permission requests
 * Reference: BAT Desktop src/components/ClaudeAgentPanel.tsx event subscriptions
 */

import { create } from 'zustand'
import type {
  ClaudeMessage,
  ClaudeToolCall,
  SessionMeta,
  SessionStateSnapshot,
  PermissionRequest,
  AskUserRequest,
  ClaudeStreamData,
  ClaudeResult,
} from '@/types'
import type { ClaudeChannel } from '@/api/channels/claude'
import { dlog } from '@/utils/debug-log'

interface SessionState {
  messages: (ClaudeMessage | ClaudeToolCall)[]
  isStreaming: boolean
  streamingText: string
  streamingThinking: string
  meta: SessionMeta | null
}

export const EMPTY_SESSION: SessionState = {
  messages: [],
  isStreaming: false,
  streamingText: '',
  streamingThinking: '',
  meta: null,
}

function createEmptySession(): SessionState {
  return {
    messages: [],
    isStreaming: false,
    streamingText: '',
    streamingThinking: '',
    meta: null,
  }
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map(item => stringifyForDisplay(item))
      .filter(Boolean)
      .join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
    if (Array.isArray(obj.content)) return stringifyForDisplay(obj.content)
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.message === 'string') return obj.message
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function normalizeRole(role: unknown): ClaudeMessage['role'] {
  return role === 'user' || role === 'assistant' || role === 'system'
    ? role
    : 'system'
}

function normalizeClaudeMessage(sessionId: string, msg: ClaudeMessage): ClaudeMessage {
  const raw = msg as unknown as Record<string, unknown>
  const content = stringifyForDisplay(raw.content)
  const thinking = stringifyForDisplay(raw.thinking)
  return {
    ...msg,
    id: stringifyForDisplay(raw.id) || `msg-${Date.now()}`,
    sessionId: stringifyForDisplay(raw.sessionId) || sessionId,
    role: normalizeRole(raw.role),
    content,
    thinking: thinking || undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
  }
}

function normalizeToolCall(sessionId: string, tool: ClaudeToolCall): ClaudeToolCall {
  const raw = tool as unknown as Record<string, unknown>
  const status = raw.status === 'running' || raw.status === 'completed' || raw.status === 'error'
    ? raw.status
    : 'running'
  return {
    ...tool,
    id: stringifyForDisplay(raw.id) || `tool-${Date.now()}`,
    sessionId: stringifyForDisplay(raw.sessionId) || sessionId,
    toolName: stringifyForDisplay(raw.toolName) || stringifyForDisplay(raw.name) || 'tool',
    input: raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)
      ? raw.input as Record<string, unknown>
      : {},
    status,
    result: raw.result == null ? undefined : stringifyForDisplay(raw.result),
    description: raw.description == null ? undefined : stringifyForDisplay(raw.description),
    denyReason: raw.denyReason == null ? undefined : stringifyForDisplay(raw.denyReason),
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
  }
}

function normalizeHistoryItem(sessionId: string, item: ClaudeMessage | ClaudeToolCall): ClaudeMessage | ClaudeToolCall {
  return 'toolName' in item
    ? normalizeToolCall(sessionId, item)
    : normalizeClaudeMessage(sessionId, item)
}

function hasAssistantTextSinceLastUser(messages: (ClaudeMessage | ClaudeToolCall)[], text: string): boolean {
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (!('toolName' in item) && item.role === 'user') {
      lastUserIndex = i
      break
    }
  }
  const candidates = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages
  return candidates.some(m => {
    if ('toolName' in m || m.role !== 'assistant') return false
    return m.content === text || m.content.includes(text) || text.includes(m.content)
  })
}

function normalizeStreamData(data: ClaudeStreamData): ClaudeStreamData {
  const raw = data as unknown as Record<string, unknown>
  return {
    text: stringifyForDisplay(raw.text),
    thinking: stringifyForDisplay(raw.thinking),
    parentToolUseId: raw.parentToolUseId == null ? undefined : stringifyForDisplay(raw.parentToolUseId),
  }
}

function findLocalDuplicateUserMessage(
  messages: (ClaudeMessage | ClaudeToolCall)[],
  msg: ClaudeMessage,
): number {
  if (msg.role !== 'user') return -1
  const normalizedContent = normalizeUserContentForDedupe(msg.content)
  return messages.findIndex(existing =>
    !('toolName' in existing) &&
    existing.role === 'user' &&
    existing.id.startsWith('user-local-') &&
    normalizeUserContentForDedupe(existing.content) === normalizedContent &&
    Math.abs(existing.timestamp - msg.timestamp) < 60_000,
  )
}

function normalizeUserContentForDedupe(content: string): string {
  return content
    .replace(/^\[\d+\s+image\(s\)\]\s*/i, '')
    .replace(/\n?\[\d+\s+images?\s+attached\]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface ClaudeState {
  sessions: Record<string, SessionState>
  activeSessionId: string | null

  // Global modal state
  pendingPermission: (PermissionRequest & { sessionId: string }) | null
  pendingAskUser: (AskUserRequest & { sessionId: string }) | null
  promptSuggestions: string[]

  // Session management
  initSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  getSession: (sessionId: string) => SessionState

  // Event handlers (called by subscription setup)
  handleMessage: (sessionId: string, msg: ClaudeMessage) => void
  handleToolUse: (sessionId: string, tool: ClaudeToolCall) => void
  handleToolResult: (sessionId: string, result: { id: string; status: string; result?: string; description?: string }) => void
  handleStream: (sessionId: string, data: ClaudeStreamData) => void
  handleResult: (sessionId: string, result: ClaudeResult) => void
  handleTurnEnd: (sessionId: string) => void
  handleError: (sessionId: string, error: string) => void
  handleStatus: (sessionId: string, meta: SessionMeta) => void
  handleSessionState: (sessionId: string, snapshot: SessionStateSnapshot | null | undefined) => void
  handlePermissionRequest: (sessionId: string, data: PermissionRequest) => void
  handleAskUser: (sessionId: string, data: AskUserRequest) => void
  handleHistory: (sessionId: string, items: (ClaudeMessage | ClaudeToolCall)[]) => void
  handleModeChange: (sessionId: string, mode: string) => void
  handlePromptSuggestion: (sessionId: string, suggestion: string) => void
  handleSessionReset: (sessionId: string) => void

  // UI Actions
  clearPermission: () => void
  clearAskUser: () => void
  clearPromptSuggestions: () => void
}

export const useClaudeStore = create<ClaudeState>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  pendingPermission: null,
  pendingAskUser: null,
  promptSuggestions: [],

  initSession: (sessionId) => {
    const { sessions } = get()
    if (!sessions[sessionId]) {
      set({
        sessions: { ...sessions, [sessionId]: createEmptySession() },
      })
    }
  },

  setActiveSession: (sessionId) => {
    set({ activeSessionId: sessionId })
  },

  getSession: (sessionId) => {
    return get().sessions[sessionId] || EMPTY_SESSION
  },

  // ---- Event Handlers ----

  handleMessage: (sessionId, rawMsg) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    const msg = normalizeClaudeMessage(sessionId, rawMsg)
    dlog('CLAUDE_STORE', `handleMessage sid=${sessionId} msgId=${msg.id} role=${msg.role} content.len=${msg.content?.length}`)

    // Deduplicate by id
    if (session.messages.some(m => m.id === msg.id)) {
      dlog('CLAUDE_STORE', `handleMessage DEDUPE skip msgId=${msg.id}`)
      return
    }

    const localDuplicateIndex = findLocalDuplicateUserMessage(session.messages, msg)
    if (localDuplicateIndex >= 0) {
      dlog('CLAUDE_STORE', `handleMessage replace local duplicate with msgId=${msg.id}`)
      const messages = [...session.messages]
      messages[localDuplicateIndex] = msg
      set({
        sessions: {
          ...sessions,
          [sessionId]: {
            ...session,
            messages,
            isStreaming: false,
            streamingText: '',
            streamingThinking: '',
          },
        },
      })
      return
    }

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages: [...session.messages, msg],
          isStreaming: false,
          streamingText: '',
          streamingThinking: '',
        },
      },
    })
  },

  handleToolUse: (sessionId, rawTool) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    const tool = normalizeToolCall(sessionId, rawTool)

    if (session.messages.some(m => m.id === tool.id)) return

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages: [...session.messages, tool],
        },
      },
    })
  },

  handleToolResult: (sessionId, result) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    const normalizedResult = {
      ...result,
      result: result.result == null ? undefined : stringifyForDisplay(result.result),
      description: result.description == null ? undefined : stringifyForDisplay(result.description),
    }

    const messages = session.messages.map(m => {
      if ('toolName' in m && m.id === normalizedResult.id) {
        return {
          ...m,
          status: normalizedResult.status as ClaudeToolCall['status'],
          result: normalizedResult.result ?? m.result,
          description: normalizedResult.description ?? m.description,
        }
      }
      return m
    })

    set({
      sessions: {
        ...sessions,
        [sessionId]: { ...session, messages },
      },
    })
  },

  handleStream: (sessionId, rawData) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    const data = normalizeStreamData(rawData)
    if (!session.isStreaming) {
      dlog('CLAUDE_STORE', `handleStream START sid=${sessionId}`)
    }

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          streamingText: data.text
            ? session.streamingText + data.text
            : session.streamingText,
          streamingThinking: data.thinking
            ? session.streamingThinking + data.thinking
            : session.streamingThinking,
        },
      },
    })
  },

  handleResult: (sessionId, result) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    dlog('CLAUDE_STORE', `handleResult sid=${sessionId} streamingText.len=${session.streamingText.length} msgs=${session.messages.length}`)

    // If there's streaming/result text that wasn't captured as a message, preserve it.
    // Some desktop Claude events carry a null message id/content and rely on result.result
    // as the final display text.
    let messages = session.messages
    if (session.streamingText.trim()) {
      const streamMsg: ClaudeMessage = {
        id: `stream-${Date.now()}`,
        sessionId,
        role: 'assistant',
        content: session.streamingText,
        thinking: session.streamingThinking || undefined,
        timestamp: Date.now(),
      }
      messages = [...messages, streamMsg]
      dlog('CLAUDE_STORE', `preserved streaming text as message (${session.streamingText.length} chars)`)
    }
    const resultText = stringifyForDisplay(result?.result).trim()
    if (resultText && result?.subtype === 'success' && !hasAssistantTextSinceLastUser(messages, resultText)) {
      messages = [...messages, {
        id: `result-${Date.now()}`,
        sessionId,
        role: 'assistant',
        content: resultText,
        timestamp: Date.now(),
      }]
      dlog('CLAUDE_STORE', `preserved result text as message (${resultText.length} chars)`)
    }

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages,
          isStreaming: false,
          streamingText: '',
          streamingThinking: '',
        },
      },
    })
  },

  handleTurnEnd: (sessionId) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          isStreaming: false,
          streamingText: '',
          streamingThinking: '',
        },
      },
    })
  },

  handleError: (sessionId, error) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()

    const errorMsg: ClaudeMessage = {
      id: `error-${Date.now()}`,
      sessionId,
      role: 'system',
      content: stringifyForDisplay(error),
      timestamp: Date.now(),
    }

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          isStreaming: false,
          streamingText: '',
          messages: [...session.messages, errorMsg],
        },
      },
    })
  },

  handleStatus: (sessionId, meta) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()

    set({
      sessions: {
        ...sessions,
        [sessionId]: { ...session, meta },
      },
    })

  },

  handleSessionState: (sessionId, snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    const rawMessages = Array.isArray(snapshot.messages) ? snapshot.messages : null
    const nextMessages = rawMessages
      ? rawMessages.map(item => normalizeHistoryItem(sessionId, item))
      : session.messages
    const shouldReplaceMessages = rawMessages !== null && (nextMessages.length > 0 || session.messages.length === 0)
    dlog('CLAUDE_STORE', `handleSessionState sid=${sessionId} messages=${rawMessages?.length ?? 'n/a'} streaming=${snapshot.isStreaming === true}`)

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages: shouldReplaceMessages ? nextMessages : session.messages,
          isStreaming: snapshot.isStreaming ?? session.isStreaming,
          streamingText: snapshot.streamingText ?? session.streamingText,
          streamingThinking: snapshot.streamingThinking ?? session.streamingThinking,
          meta: snapshot.meta ?? session.meta,
        },
      },
    })
  },

  handlePermissionRequest: (sessionId, data) => {
    set({ pendingPermission: { ...data, sessionId } })
  },

  handleAskUser: (sessionId, data) => {
    set({ pendingAskUser: { ...data, sessionId } })
  },

  handleHistory: (sessionId, items) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    dlog('CLAUDE_STORE', `handleHistory sid=${sessionId} items=${items?.length ?? 0}`)
    const messages = (items || []).map(item => normalizeHistoryItem(sessionId, item))

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages,
        },
      },
    })
  },

  handleModeChange: (sessionId, mode) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          meta: session.meta ? { ...session.meta, permissionMode: mode } : null,
        },
      },
    })
  },

  handlePromptSuggestion: (_sessionId, suggestion) => {
    set({ promptSuggestions: [suggestion] })
  },

  handleSessionReset: (sessionId) => {
    const { sessions } = get()
    dlog('CLAUDE_STORE', `handleSessionReset sid=${sessionId}`)
    set({
      sessions: {
        ...sessions,
        [sessionId]: createEmptySession(),
      },
      promptSuggestions: [],
    })
  },

  // ---- UI Actions ----

  clearPermission: () => set({ pendingPermission: null }),
  clearAskUser: () => set({ pendingAskUser: null }),
  clearPromptSuggestions: () => set({ promptSuggestions: [] }),
}))

/**
 * Subscribe to all Claude events from the WebSocket client.
 * Call this once after connection is established.
 * Returns unsubscribe function.
 */
export function subscribeClaudeEvents(claude: ClaudeChannel): () => void {
  const unsubs: Array<() => void> = []

  unsubs.push(claude.onMessage((sid, msg) => useClaudeStore.getState().handleMessage(sid, msg)))
  unsubs.push(claude.onToolUse((sid, tool) => useClaudeStore.getState().handleToolUse(sid, tool)))
  unsubs.push(claude.onToolResult((sid, result) => useClaudeStore.getState().handleToolResult(sid, result)))
  unsubs.push(claude.onStream((sid, data) => useClaudeStore.getState().handleStream(sid, data)))
  unsubs.push(claude.onResult((sid, result) => useClaudeStore.getState().handleResult(sid, result)))
  unsubs.push(claude.onTurnEnd((sid) => useClaudeStore.getState().handleTurnEnd(sid)))
  unsubs.push(claude.onError((sid, error) => useClaudeStore.getState().handleError(sid, error)))
  unsubs.push(claude.onStatus((sid, meta) => useClaudeStore.getState().handleStatus(sid, meta)))
  unsubs.push(claude.onPermissionRequest((sid, data) => useClaudeStore.getState().handlePermissionRequest(sid, data)))
  unsubs.push(claude.onAskUser((sid, data) => useClaudeStore.getState().handleAskUser(sid, data)))
  unsubs.push(claude.onHistory((sid, items) => useClaudeStore.getState().handleHistory(sid, items)))
  unsubs.push(claude.onModeChange((sid, mode) => useClaudeStore.getState().handleModeChange(sid, mode)))
  unsubs.push(claude.onPromptSuggestion((sid, sug) => useClaudeStore.getState().handlePromptSuggestion(sid, sug)))
  unsubs.push(claude.onSessionReset((sid) => useClaudeStore.getState().handleSessionReset(sid)))

  return () => {
    for (const unsub of unsubs) unsub()
  }
}
