/**
 * Claude Store - manages Claude agent sessions, messages, streaming, permission requests
 * Reference: BAT Desktop src/components/ClaudeAgentPanel.tsx event subscriptions
 */

import { create } from 'zustand'
import type {
  ClaudeMessage,
  ClaudeToolCall,
  SessionMeta,
  PermissionRequest,
  AskUserRequest,
  ClaudeStreamData,
  ClaudeResult,
  isToolCall,
} from '@/types'
import type { ClaudeChannel } from '@/api/channels/claude'
import { useWorkspaceStore } from './workspace-store'
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
  handleError: (sessionId: string, error: string) => void
  handleStatus: (sessionId: string, meta: SessionMeta) => void
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

  handleMessage: (sessionId, msg) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    dlog('CLAUDE_STORE', `handleMessage sid=${sessionId} msgId=${msg.id} role=${msg.role} content.len=${msg.content?.length}`)

    // Deduplicate by id
    if (session.messages.some(m => m.id === msg.id)) {
      dlog('CLAUDE_STORE', `handleMessage DEDUPE skip msgId=${msg.id}`)
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

  handleToolUse: (sessionId, tool) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()

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

    const messages = session.messages.map(m => {
      if ('toolName' in m && m.id === result.id) {
        return {
          ...m,
          status: result.status as ClaudeToolCall['status'],
          result: result.result ?? m.result,
          description: result.description ?? m.description,
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

  handleStream: (sessionId, data) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
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

    // If there's streaming text that wasn't captured as a message, preserve it
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

  handleError: (sessionId, error) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()

    const errorMsg: ClaudeMessage = {
      id: `error-${Date.now()}`,
      sessionId,
      role: 'system',
      content: error,
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

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages: items || [],
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
    // Clear stale sdkSessionId in workspace store
    const wsStore = useWorkspaceStore.getState()
    const terminals = wsStore.terminals.map(t =>
      t.id === sessionId ? { ...t, sdkSessionId: undefined } : t
    )
    useWorkspaceStore.setState({ terminals })
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
  const store = useClaudeStore.getState()
  const unsubs: Array<() => void> = []

  unsubs.push(claude.onMessage((sid, msg) => useClaudeStore.getState().handleMessage(sid, msg)))
  unsubs.push(claude.onToolUse((sid, tool) => useClaudeStore.getState().handleToolUse(sid, tool)))
  unsubs.push(claude.onToolResult((sid, result) => useClaudeStore.getState().handleToolResult(sid, result)))
  unsubs.push(claude.onStream((sid, data) => useClaudeStore.getState().handleStream(sid, data)))
  unsubs.push(claude.onResult((sid, result) => useClaudeStore.getState().handleResult(sid, result)))
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
