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
import { useConnectionStore } from '@/stores/connection-store'
import { dlog } from '@/utils/debug-log'
import { isCompactSummaryMessage } from '@/utils/compact-summary'

interface SessionState {
  messages: (ClaudeMessage | ClaudeToolCall)[]
  isStreaming: boolean
  streamingText: string
  streamingThinking: string
  meta: SessionMeta | null
  // Local-clock timestamp of the last meta.runtimeStatus change —
  // meta.runtimeStatusStartedAt is host time and may be skewed.
  runtimeStatusSince: number | null
  // Local-clock timestamp the current turn started working, spanning the whole
  // turn (waiting → thinking → responding → tools) until turn-end — drives the
  // persistent "Working… · Xs" bar, mirroring the host's turn status line.
  turnStartedAt: number | null
}

export const EMPTY_SESSION: SessionState = {
  messages: [],
  isStreaming: false,
  streamingText: '',
  streamingThinking: '',
  meta: null,
  runtimeStatusSince: null,
  turnStartedAt: null,
}

// Zeroed usage counters, for building a meta out of a host snapshot that only
// carries model/permissionMode (no turn has been billed yet).
const EMPTY_META: SessionMeta = {
  totalCost: 0,
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
  numTurns: 0,
  contextWindow: 0,
}

function createEmptySession(): SessionState {
  return {
    messages: [],
    isStreaming: false,
    streamingText: '',
    streamingThinking: '',
    meta: null,
    runtimeStatusSince: null,
    turnStartedAt: null,
  }
}

// The host broadcasts the cleared status itself, but also drop it locally on
// any frame that proves the model responded (stream/result/turn-end/error) so
// a missed event can't leave a stale "waiting" banner.
function clearedRuntimeMeta(meta: SessionMeta | null): SessionMeta | null {
  if (!meta?.runtimeStatus && !meta?.runtimeMessage && !meta?.runtimeStatusStartedAt) return meta
  return { ...meta, runtimeStatus: null, runtimeMessage: null, runtimeStatusStartedAt: null }
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
  const role = normalizeRole(raw.role)
  return {
    ...msg,
    id: stringifyForDisplay(raw.id) || `msg-${Date.now()}`,
    sessionId: stringifyForDisplay(raw.sessionId) || sessionId,
    role,
    content,
    thinking: thinking || undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    // Both the live stream and replayed history land here, so tagging it once
    // covers every way a compaction summary reaches the chat.
    isCompactSummary: isCompactSummaryMessage(role, content, raw.isCompactSummary) || undefined,
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

/**
 * The host scrubs these out of an assistant message before echoing it
 * (node-sidecar claude-send.mjs) but streams the deltas raw, so the streamed
 * copy and the echoed message only line up once both went through the same
 * scrub. Without it a notification block sitting mid-reply makes each copy a
 * non-substring of the other, and the reply gets shown twice.
 */
function scrubHostNoise(text: string): string {
  return text
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/Full transcript available at:.*$/gm, '')
    .trim()
}

/**
 * Fold the in-flight streamed reply into the message list.
 *
 * Streamed assistant text lives only in session.streamingText until something
 * commits it, and handleResult was the only path that did. Every other terminal
 * path just cleared it, so a turn that ended via turn-end/error — or whose
 * result frame never arrived, e.g. the host reporting "LiveQuery is closed" —
 * silently lost the entire reply while its tool calls survived.
 *
 * `echoedContent` is the message about to be appended by the caller: when the
 * host both streams the text and re-sends it as a message, committing would
 * show it twice.
 */
function commitStreamedText(
  sessionId: string,
  session: SessionState,
  echoedContent?: string,
): (ClaudeMessage | ClaudeToolCall)[] {
  const text = session.streamingText
  if (!text.trim()) return session.messages
  const scrubbed = scrubHostNoise(text)
  if (echoedContent) {
    const echoed = scrubHostNoise(echoedContent)
    if (echoed.includes(scrubbed) || scrubbed.includes(echoed)) return session.messages
  }
  // Exact match only: a looser check would treat a long reply that happens to
  // quote an earlier short one as a duplicate and drop it — the very bug this
  // function exists to fix.
  const alreadyCommitted = session.messages.some(
    m => !('toolName' in m) && m.role === 'assistant' && scrubHostNoise(m.content) === scrubbed,
  )
  if (alreadyCommitted) return session.messages

  dlog('CLAUDE_STORE', `commitStreamedText sid=${sessionId} chars=${text.length}`)
  return [...session.messages, {
    id: `stream-${session.messages.length}-${Date.now()}`,
    sessionId,
    role: 'assistant',
    // Scrubbed, so this bubble reads the same as the host's own echo of it.
    content: scrubbed,
    thinking: session.streamingThinking || undefined,
    timestamp: Date.now(),
  }]
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

/**
 * The assistant counterpart of findLocalDuplicateUserMessage: locate the
 * locally committed copy of the reply the host is now echoing.
 *
 * commitStreamedText's `echoedContent` guard only stops a commit happening in
 * the same call as the echo. When the stream was committed earlier — a turn
 * that ended while the socket was down, then the host's message arriving after
 * the reconnect — nothing linked the two and the reply showed up twice.
 *
 * Only stream-committed messages after the last user turn are candidates, so a
 * reply that quotes an older one can't cannibalise it.
 */
function findCommittedStreamDuplicate(
  messages: (ClaudeMessage | ClaudeToolCall)[],
  msg: ClaudeMessage,
): number {
  if (msg.role !== 'assistant') return -1
  const content = scrubHostNoise(msg.content)
  if (!content) return -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const existing = messages[i]
    if ('toolName' in existing) continue
    if (existing.role === 'user') return -1
    if (existing.role !== 'assistant' || !existing.id.startsWith('stream-')) continue
    const committed = scrubHostNoise(existing.content)
    if (committed === content || committed.includes(content) || content.includes(committed)) return i
  }
  return -1
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
  handlePermissionResolved: (sessionId: string, toolUseId: string) => void
  handleAskUser: (sessionId: string, data: AskUserRequest) => void
  handleAskUserResolved: (sessionId: string, toolUseId: string) => void
  handleHistory: (sessionId: string, items: (ClaudeMessage | ClaudeToolCall)[]) => void
  handleModeChange: (sessionId: string, mode: string) => void
  handlePromptSuggestion: (sessionId: string, suggestion: string) => void
  handleSessionReset: (sessionId: string) => void
  setUserMessageStatus: (sessionId: string, id: string, status: ClaudeMessage['status'], failureReason?: string) => void
  // Re-deliver a 'failed' optimistic user message using its stored payload.
  retryUserMessage: (sessionId: string, id: string) => void

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
      // Copy: commitStreamedText returns session.messages by reference when
      // there is nothing to commit, and the splice below must not mutate it.
      const messages = [...commitStreamedText(sessionId, session, msg.content)]
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

    // A subagent's reply is its own conversation: it must neither fold nor
    // clear the main agent's in-flight text, which is still mid-reply.
    const fromSubagent = !!(msg as { parentToolUseId?: string }).parentToolUseId
    if (fromSubagent) {
      set({
        sessions: {
          ...sessions,
          [sessionId]: { ...session, messages: [...session.messages, msg] },
        },
      })
      return
    }

    // The host is authoritative: when we already committed this reply locally,
    // swap our copy for the host's instead of stacking both.
    const committedIndex = findCommittedStreamDuplicate(session.messages, msg)
    let messages: (ClaudeMessage | ClaudeToolCall)[]
    if (committedIndex >= 0) {
      dlog('CLAUDE_STORE', `handleMessage replace committed stream copy at ${committedIndex} with msgId=${msg.id}`)
      messages = [...session.messages]
      messages[committedIndex] = msg
    } else {
      messages = [...commitStreamedText(sessionId, session, msg.content), msg]
    }

    // An optimistic local send opens a turn so the working bar appears the
    // instant the user hits send, before the host's first status frame.
    const startsTurn = msg.role === 'user' && msg.status === 'sending'
    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages,
          isStreaming: false,
          streamingText: '',
          streamingThinking: '',
          turnStartedAt: startsTurn ? (session.turnStartedAt ?? Date.now()) : session.turnStartedAt,
        },
      },
    })
  },

  // Flip a still-pending optimistic user message to 'sent' / 'failed'. No-op if
  // the message was already replaced by the host's echoed copy (id not found),
  // so a late invoke timeout cannot resurrect an already-confirmed message.
  setUserMessageStatus: (sessionId, id, status, failureReason) => {
    const { sessions } = get()
    const session = sessions[sessionId]
    if (!session) return
    const idx = session.messages.findIndex(m => m.id === id)
    if (idx < 0) return
    const existing = session.messages[idx]
    if ('toolName' in existing || existing.status === status) return
    const messages = [...session.messages]
    messages[idx] = { ...existing, status, failureReason: status === 'failed' ? failureReason : undefined }
    set({ sessions: { ...sessions, [sessionId]: { ...session, messages } } })
  },

  retryUserMessage: (sessionId, id) => {
    const session = get().sessions[sessionId]
    if (!session) return
    const existing = session.messages.find(m => m.id === id)
    if (!existing || 'toolName' in existing || existing.status !== 'failed' || !existing.sendPayload) return
    const channels = useConnectionStore.getState().channels
    if (!channels) return

    const { messageText, images } = existing.sendPayload
    // Flip back to the ghosted state, then run the same deliver path as a
    // fresh send: success solidifies it, another failure re-arms retry.
    get().setUserMessageStatus(sessionId, id, 'sending')
    channels.claude.sendMessage(sessionId, messageText, images)
      .then(() => {
        useClaudeStore.getState().setUserMessageStatus(sessionId, id, 'sent')
      })
      .catch(e => {
        const reason = e instanceof Error ? e.message : String(e)
        dlog('!CLAUDE_STORE', `retryUserMessage failed id=${id}: ${reason}`)
        useClaudeStore.getState().setUserMessageStatus(sessionId, id, 'failed', reason)
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
          // Tool execution is part of the active turn; keep the bar alive
          // through tool gaps where nothing is streaming.
          turnStartedAt: session.turnStartedAt ?? Date.now(),
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

    // Subagent deltas belong to a nested conversation. The host keeps them out
    // of the session's streamingText (state.mjs appendSessionStream) and the
    // desktop buckets them per task; we have no task view, so we drop them.
    // Merging them in interleaved the main reply with subagent chatter, which
    // then failed the echo check and got the whole reply rendered twice.
    // The turn is still live, so the working bar keeps running.
    const fromSubagent = !!data.parentToolUseId

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          streamingText: data.text && !fromSubagent
            ? session.streamingText + data.text
            : session.streamingText,
          streamingThinking: data.thinking && !fromSubagent
            ? session.streamingThinking + data.thinking
            : session.streamingThinking,
          meta: clearedRuntimeMeta(session.meta),
          runtimeStatusSince: null,
          turnStartedAt: session.turnStartedAt ?? Date.now(),
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
    let messages = commitStreamedText(sessionId, session)
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
          meta: clearedRuntimeMeta(session.meta),
          runtimeStatusSince: null,
          turnStartedAt: null,
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
          messages: commitStreamedText(sessionId, session),
          isStreaming: false,
          streamingText: '',
          streamingThinking: '',
          meta: clearedRuntimeMeta(session.meta),
          runtimeStatusSince: null,
          turnStartedAt: null,
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
          // An error ends the turn too — keep whatever the model had already
          // said instead of replacing the reply with just the error line.
          messages: [...commitStreamedText(sessionId, session), errorMsg],
          meta: clearedRuntimeMeta(session.meta),
          runtimeStatusSince: null,
          turnStartedAt: null,
        },
      },
    })
  },

  handleStatus: (sessionId, meta) => {
    const { sessions } = get()
    const session = sessions[sessionId] || createEmptySession()
    // A status meta is a turn/usage snapshot and does not always carry the
    // session's model or permission mode. Replacing wholesale would drop the
    // host model adopted by handleSessionState (which reads it from the
    // snapshot's top level), so the model chip would blink out on every
    // refresh. Keep the last known value when the incoming meta omits one.
    const mergedMeta = meta
      ? {
          ...meta,
          ...(meta.model == null && session.meta?.model ? { model: session.meta.model } : {}),
          ...(meta.permissionMode == null && session.meta?.permissionMode
            ? { permissionMode: session.meta.permissionMode }
            : {}),
        }
      : meta
    const runtimeStatusSince = meta?.runtimeStatus
      ? (session.meta?.runtimeStatus === meta.runtimeStatus
        ? (session.runtimeStatusSince ?? Date.now())
        : Date.now())
      : null
    // A runtime status means the host is working this turn; keep the existing
    // turn start so elapsed spans the whole turn. Clearing happens on turn-end.
    const turnStartedAt = meta?.runtimeStatus
      ? (session.turnStartedAt ?? Date.now())
      : session.turnStartedAt

    set({
      sessions: {
        ...sessions,
        [sessionId]: { ...session, meta: mergedMeta, runtimeStatusSince, turnStartedAt },
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
    // A snapshot carrying fewer messages than we already show is the host's
    // live tail, not a shorter conversation. Long sessions get archived out of
    // the host's memory, so `getSessionState` can answer with the last handful
    // while the real transcript runs to hundreds — and this runs on every
    // refocus and reconnect. Replacing on sight traded the conversation on
    // screen for that handful, which is what "讀不到歷史對話" looks like:
    // a blank scrollback above the few newest tool calls.
    //
    // Compaction is the one legitimate shrink — the host really does swap the
    // conversation for a summary plus recent turns — and it announces itself
    // with a summary message, so that still comes through. /new clears via
    // handleSessionReset, which empties the list and lets the next snapshot in.
    const carriesCompactSummary = nextMessages.some(item => 'role' in item
      && isCompactSummaryMessage(item.role, item.content ?? '', item.isCompactSummary))
    const shouldReplaceMessages = rawMessages !== null && (
      session.messages.length === 0
      || (nextMessages.length > 0
        && (nextMessages.length >= session.messages.length || carriesCompactSummary))
    )
    if (rawMessages !== null && !shouldReplaceMessages) {
      dlog('!CLAUDE_STORE', `kept ${session.messages.length} local messages over a ${nextMessages.length}-message snapshot sid=${sessionId}`)
    }
    dlog('CLAUDE_STORE', `handleSessionState sid=${sessionId} messages=${rawMessages?.length ?? 'n/a'} streaming=${snapshot.isStreaming === true}`)

    // Authoritative correction on (re)focus: if the host is clearly working,
    // make sure the bar shows; if it's clearly idle, drop a turn that may have
    // ended while we were away. Ambiguous snapshots leave the local turn alone.
    const hostActive = snapshot.isStreaming === true || !!snapshot.meta?.runtimeStatus
    const hostIdle = snapshot.isStreaming === false && snapshot.meta != null && !snapshot.meta.runtimeStatus
    const turnStartedAt = hostActive
      ? (session.turnStartedAt ?? Date.now())
      : hostIdle
        ? null
        : session.turnStartedAt

    // The host's getSessionState carries the authoritative model / permission
    // mode at the TOP LEVEL (not nested under meta). Adopt them so a model
    // change made on the host or another client shows up the moment we refocus
    // and re-pull state — the model chip reads session.meta.model, and the host
    // never broadcasts a status event for a bare setModel. Remote state is
    // host-owned, so the host's value overrides our last-known meta.
    // A session the host has never billed a turn for has no meta at all, so
    // don't gate on baseMeta: synthesize one from the top-level fields, or the
    // model/permission chips stay blank until the first result lands.
    const baseMeta = snapshot.meta ?? session.meta
    const hostModel = typeof snapshot.model === 'string' ? snapshot.model : undefined
    const hostPermissionMode = typeof snapshot.permissionMode === 'string' ? snapshot.permissionMode : undefined
    const nextMeta = baseMeta || hostModel || hostPermissionMode
      ? {
          ...(baseMeta ?? EMPTY_META),
          ...(hostModel ? { model: hostModel } : {}),
          ...(hostPermissionMode ? { permissionMode: hostPermissionMode } : {}),
        }
      : baseMeta

    set({
      sessions: {
        ...sessions,
        [sessionId]: {
          ...session,
          messages: shouldReplaceMessages ? nextMessages : session.messages,
          isStreaming: snapshot.isStreaming ?? session.isStreaming,
          streamingText: snapshot.streamingText ?? session.streamingText,
          streamingThinking: snapshot.streamingThinking ?? session.streamingThinking,
          meta: nextMeta,
          turnStartedAt,
        },
      },
    })
  },

  handlePermissionRequest: (sessionId, data) => {
    set({ pendingPermission: { ...data, sessionId } })
  },

  handlePermissionResolved: (sessionId, toolUseId) => {
    const { pendingPermission } = get()
    if (
      pendingPermission &&
      pendingPermission.sessionId === sessionId &&
      pendingPermission.toolUseId === toolUseId
    ) {
      set({ pendingPermission: null })
    }
  },

  handleAskUser: (sessionId, data) => {
    set({ pendingAskUser: { ...data, sessionId } })
  },

  handleAskUserResolved: (sessionId, toolUseId) => {
    const { pendingAskUser } = get()
    if (
      pendingAskUser &&
      pendingAskUser.sessionId === sessionId &&
      pendingAskUser.toolUseId === toolUseId
    ) {
      set({ pendingAskUser: null })
    }
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
  unsubs.push(claude.onPermissionResolved((sid, toolUseId) => useClaudeStore.getState().handlePermissionResolved(sid, toolUseId)))
  unsubs.push(claude.onAskUser((sid, data) => useClaudeStore.getState().handleAskUser(sid, data)))
  unsubs.push(claude.onAskUserResolved((sid, toolUseId) => useClaudeStore.getState().handleAskUserResolved(sid, toolUseId)))
  unsubs.push(claude.onHistory((sid, items) => useClaudeStore.getState().handleHistory(sid, items)))
  unsubs.push(claude.onModeChange((sid, mode) => useClaudeStore.getState().handleModeChange(sid, mode)))
  unsubs.push(claude.onPromptSuggestion((sid, sug) => useClaudeStore.getState().handlePromptSuggestion(sid, sug)))
  unsubs.push(claude.onSessionReset((sid) => useClaudeStore.getState().handleSessionReset(sid)))

  return () => {
    for (const unsub of unsubs) unsub()
  }
}
