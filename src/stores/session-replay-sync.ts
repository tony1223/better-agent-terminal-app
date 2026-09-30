import { AppState } from 'react-native'
import type {
  ClaudeChannel,
  RecordedAgentEvent,
  SessionSyncEvent,
  SyncCursor,
} from '@/api/channels/claude'
import { eventParamsToArgs } from '@/api/websocket-client'
import { useClaudeStore } from './claude-store'
import { useConnectionStore } from './connection-store'
import { dlog } from '@/utils/debug-log'

const refreshers = new Map<
  ClaudeChannel,
  (sessionId: string) => Promise<boolean>
>()
const legacyFallbacks = new Map<ClaudeChannel, Set<string>>()
const transcriptGaps = new Map<ClaudeChannel, Set<string>>()
export const sessionReplayHasTranscriptGap = (
  channel: ClaudeChannel,
  id: string,
) => transcriptGaps.get(channel)?.has(id) ?? false
export const usesLegacySessionEvents = (channel: ClaudeChannel, id: string) =>
  !legacyFallbacks.has(channel) || legacyFallbacks.get(channel)!.has(id)
export async function refreshSessionReplay(
  channel: ClaudeChannel,
  id: string,
): Promise<boolean> {
  const refresh = refreshers.get(channel)
  if (!refresh) return false
  const result = await refresh(id)
  // A foreground call can join a pull that began before suspension. Join its
  // fresh retry rather than interleave an unsequenced snapshot with deltas.
  if (
    !result &&
    refreshers.get(channel) === refresh &&
    !usesLegacySessionEvents(channel, id) &&
    !sessionReplayHasTranscriptGap(channel, id)
  )
    return refresh(id)
  return result
}

export function applyRecordedAgentEvent(event: RecordedAgentEvent) {
  const store = useClaudeStore.getState()
  const channel = event.channel.replace(/^agent:/, 'claude:')
  const handlers = {
    'claude:message': store.handleMessage,
    'claude:tool-use': store.handleToolUse,
    'claude:tool-result': store.handleToolResult,
    'claude:stream': store.handleStream,
    'claude:result': store.handleResult,
    'claude:turn-end': store.handleTurnEnd,
    'claude:error': store.handleError,
    'claude:status': store.handleStatus,
    'claude:permission-request': store.handlePermissionRequest,
    'claude:permission-resolved': store.handlePermissionResolved,
    'claude:ask-user': store.handleAskUser,
    'claude:ask-user-resolved': store.handleAskUserResolved,
    'claude:history': store.handleHistory,
    'claude:modeChange': store.handleModeChange,
    'claude:prompt-suggestion': store.handlePromptSuggestion,
    'claude:session-reset': store.handleSessionReset,
  }
  const handler = handlers[channel as keyof typeof handlers] as
    | ((...args: unknown[]) => void)
    | undefined
  const args = eventParamsToArgs(channel, event.params)
  const at =
    typeof event.at === 'number' && Number.isFinite(event.at) && event.at > 0
      ? event.at
      : undefined
  if (channel === 'claude:turn-end') args[1] = at
  else if (channel === 'claude:stream' || channel === 'claude:result')
    args[2] = at
  handler?.(...args)
  if (at && typeof event.params.sessionId === 'string') {
    const data = event.params.data as
      | { text?: string; thinking?: string }
      | undefined
    const message = event.params.message as { role?: string } | undefined
    const output =
      channel === 'claude:stream'
        ? !!(data?.text || data?.thinking)
        : channel === 'claude:message'
        ? message?.role === 'assistant'
        : [
            'claude:tool-use',
            'claude:tool-result',
            'claude:result',
            'claude:turn-end',
            'claude:error',
            'claude:permission-request',
            'claude:ask-user',
          ].includes(channel)
    if (output)
      useClaudeStore.getState().handleLastDataAt(event.params.sessionId, at)
  }
}

export function subscribeSessionReplay(channel: ClaudeChannel): () => void {
  const scope = useClaudeStore.getState().scopeKey
  const client = useConnectionStore.getState().client
  let disposed = false
  let foreground =
    AppState.currentState !== 'background' &&
    AppState.currentState !== 'inactive'
  const queues = new Map<string, SessionSyncEvent[]>()
  const flights = new Map<string, Promise<boolean>>()
  const resumePending = new Set<string>()
  const overflow = new Set<string>()
  const needsTranscript = new Set<string>()
  transcriptGaps.set(channel, needsTranscript)
  const fallbacks = new Set<string>()
  const retryAfter = new Map<string, number>()
  legacyFallbacks.set(channel, fallbacks)
  let generation = 0
  let queueBytes = 0
  const current = () =>
    !disposed &&
    foreground &&
    useClaudeStore.getState().scopeKey === scope &&
    useConnectionStore.getState().client === client &&
    useConnectionStore.getState().channels?.claude === channel
  const cursorFor = (id: string) =>
    useClaudeStore.getState().sessions[id]?.syncCursor
  const apply = (
    id: string,
    cursor: SyncCursor,
    events: RecordedAgentEvent[],
  ) => {
    let sequence = cursor.seq
    // Validate the whole batch before mutating streamed text.
    for (const event of events) {
      if (
        !Number.isSafeInteger(event.seq) ||
        event.seq < 0 ||
        event.params?.sessionId !== id ||
        typeof event.channel !== 'string'
      )
        throw new Error('Invalid replay event')
      if (event.seq <= sequence) continue
      if (event.seq !== sequence + 1) throw new Error('Replay sequence gap')
      sequence = event.seq
    }
    sequence = cursor.seq
    for (const event of events) {
      if (event.seq <= sequence) continue
      applyRecordedAgentEvent(event)
      if (
        event.channel === 'claude:history' ||
        event.channel === 'agent:history' ||
        event.channel.endsWith(':session-reset')
      )
        needsTranscript.delete(id)
      sequence = event.seq
      useClaudeStore
        .getState()
        .setSyncCursor(
          id,
          { epoch: cursor.epoch, seq: sequence },
          event.channel.endsWith(':history') ||
            event.channel.endsWith(':history-checkpoint')
            ? undefined
            : true,
        )
    }
    return sequence
  }
  const clearQueue = (id: string) => {
    queues.delete(id)
    queueBytes = [...queues.values()].reduce(
      (size, values) => size + JSON.stringify(values).length,
      0,
    )
  }
  function sync(id: string): Promise<boolean> {
    if (!current()) return Promise.resolve(false)
    if ((retryAfter.get(id) ?? 0) > Date.now()) return Promise.resolve(false)
    const previous = flights.get(id)
    if (previous) return previous
    const started = generation
    const task = (async () => {
      try {
        // Bounded pages and memory; when overwhelmed retain the view and use
        // snapshot recovery rather than keeping an unbounded event queue.
        for (let page = 0; page < 64; page++) {
          const previousCursor = fallbacks.has(id) ? undefined : cursorFor(id)
          const reply = await channel.syncSession(id, previousCursor)
          if (!current() || generation !== started) return false
          if (
            reply?.sessionId !== id ||
            typeof reply.cursor?.epoch !== 'string' ||
            !Number.isSafeInteger(reply.cursor?.seq) ||
            reply.cursor.seq < 0
          )
            throw new Error('Invalid sync checkpoint')
          if (reply.mode === 'snapshot') {
            if (reply.state) {
              const verdict = useClaudeStore
                .getState()
                .handleSessionState(id, reply.state)
              if (verdict === 'kept-local') needsTranscript.add(id)
              else needsTranscript.delete(id)
              if (reply.state.pendingPermission)
                useClaudeStore
                  .getState()
                  .handlePermissionRequest(id, reply.state.pendingPermission)
              else if (
                reply.state.pendingPermission === null &&
                useClaudeStore.getState().pendingPermission?.sessionId === id
              )
                useClaudeStore.getState().clearPermission()
              if (reply.state.pendingAskUser)
                useClaudeStore
                  .getState()
                  .handleAskUser(id, reply.state.pendingAskUser)
              else if (
                reply.state.pendingAskUser === null &&
                useClaudeStore.getState().pendingAskUser?.sessionId === id
              )
                useClaudeStore.getState().clearAskUser()
            } else useClaudeStore.getState().handleRuntimeMissing(id)
            useClaudeStore
              .getState()
              .setSyncCursor(id, reply.cursor, !!reply.state)
          } else if (
            reply.mode === 'delta' &&
            previousCursor &&
            reply.cursor.epoch === previousCursor.epoch &&
            Array.isArray(reply.events)
          ) {
            const sequence = apply(id, previousCursor, reply.events)
            if (sequence !== reply.cursor.seq)
              throw new Error('Incomplete replay checkpoint')
            if (reply.hasMore && sequence === previousCursor.seq)
              throw new Error('Replay did not advance')
          } else throw new Error('Invalid sync mode')
          if (reply.hasMore) continue
          // Live frames received during the pull are replayed only after its
          // checkpoint, in sequence, so text deltas never appear twice.
          const queued = queues.get(id) ?? []
          clearQueue(id)
          let cursor = cursorFor(id)!
          let pullAgain = overflow.delete(id)
          for (const batch of queued) {
            if (batch.epoch !== cursor.epoch) {
              pullAgain = true
              continue
            }
            if (pullAgain) continue
            const sequence = apply(id, cursor, batch.events)
            cursor = { ...cursor, seq: sequence }
          }
          if (pullAgain) continue
          fallbacks.delete(id)
          retryAfter.delete(id)
          return !needsTranscript.has(id)
        }
        throw new Error('Replay exceeds recovery budget')
      } catch (error) {
        if (current()) {
          dlog(
            '!SESSION_SYNC',
            `sync ${id} failed; preserving view and snapshot fallback: ${String(
              error,
            )}`,
          )
          fallbacks.add(id)
          retryAfter.set(id, Date.now() + 1000)
        }
        clearQueue(id)
        return false
      }
    })()
    flights.set(id, task)
    void task.finally(() => {
      if (flights.get(id) === task) flights.delete(id)
      if (resumePending.delete(id) && current()) void sync(id)
    })
    return task
  }
  const unsubEvent = channel.onSyncEvent(batch => {
    if (
      !current() ||
      typeof batch?.sessionId !== 'string' ||
      typeof batch.epoch !== 'string' ||
      !Array.isArray(batch.events)
    )
      return
    const id = batch.sessionId
    const cursor = cursorFor(id)
    if (
      !fallbacks.has(id) &&
      !flights.has(id) &&
      cursor?.epoch === batch.epoch
    ) {
      try {
        apply(id, cursor, batch.events)
        return
      } catch {
        /* Fill the gap before applying more live text. */
      }
    }
    const bytes = JSON.stringify(batch).length
    if (queueBytes + bytes < 1024 * 1024) {
      queues.set(id, [...(queues.get(id) ?? []), batch])
      queueBytes += bytes
    } else overflow.add(id)
    void sync(id)
  })
  const syncVisible = () => {
    const state = useClaudeStore.getState()
    if (state.activeSessionId) void sync(state.activeSessionId)
  }
  let active = useClaudeStore.getState().activeSessionId
  const unsubStore = useClaudeStore.subscribe(state => {
    if (state.activeSessionId !== active) {
      active = state.activeSessionId
      syncVisible()
    }
  })
  const appState = AppState.addEventListener('change', state => {
    const wasForeground = foreground
    foreground = state === 'active'
    if (foreground && !wasForeground) {
      const id = useClaudeStore.getState().activeSessionId
      if (id && flights.has(id)) resumePending.add(id)
      syncVisible()
    } else if (!foreground) {
      generation++
      queues.clear()
      overflow.clear()
      queueBytes = 0
    }
  })
  refreshers.set(channel, sync)
  syncVisible()
  return () => {
    disposed = true
    unsubEvent()
    unsubStore()
    appState.remove()
    queues.clear()
    if (refreshers.get(channel) === sync) refreshers.delete(channel)
    if (legacyFallbacks.get(channel) === fallbacks)
      legacyFallbacks.delete(channel)
    if (transcriptGaps.get(channel) === needsTranscript)
      transcriptGaps.delete(channel)
  }
}
