import { AppState } from 'react-native'
import {
  subscribeSessionReplay,
  refreshSessionReplay,
  usesLegacySessionEvents,
} from '../src/stores/session-replay-sync'
import {
  useClaudeStore,
  subscribeClaudeEvents,
} from '../src/stores/claude-store'
import { useConnectionStore } from '../src/stores/connection-store'
import type {
  ClaudeChannel,
  SessionSyncEvent,
  SessionSyncReply,
} from '../src/api/channels/claude'
import type { Channels } from '../src/api/channels'

const cursor = (seq: number, epoch = 'e') => ({ epoch, seq })
const event = (seq: number, text: string, sessionId = 's') => ({
  seq,
  channel: 'claude:stream',
  params: { sessionId, data: { text } },
})
const delta = (
  seq: number,
  events: ReturnType<typeof event>[] = [],
  hasMore = false,
): SessionSyncReply => ({
  mode: 'delta',
  sessionId: 's',
  cursor: cursor(seq),
  events,
  hasMore,
})
let channel: ClaudeChannel
let sync: jest.Mock
let receive: (event: SessionSyncEvent) => void
let change: (state: string) => void
let stop: (() => void) | undefined
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

beforeEach(() => {
  useClaudeStore.setState({
    sessions: {},
    activeSessionId: null,
    scopeKey: 'scope',
    pendingPermission: null,
    pendingAskUser: null,
  })
  useClaudeStore.getState().initSession('s')
  useClaudeStore.getState().setSyncCursor('s', cursor(0))
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_name, listener) => {
      change = listener as typeof change
      return { remove: jest.fn() }
    })
  sync = jest.fn().mockResolvedValue(delta(0))
  channel = {
    syncSession: sync,
    onSyncEvent: (cb: typeof receive) => {
      receive = cb
      return jest.fn()
    },
  } as unknown as ClaudeChannel
  useConnectionStore.setState({
    client: {} as never,
    channels: { claude: channel } as Channels,
  })
  stop = subscribeSessionReplay(channel)
})
afterEach(() => {
  stop?.()
  stop = undefined
  jest.restoreAllMocks()
})

test('live and replayed stream events are applied exactly once', async () => {
  receive({ sessionId: 's', epoch: 'e', events: [event(1, 'one')] })
  receive({ sessionId: 's', epoch: 'e', events: [event(1, 'one')] })
  sync.mockResolvedValue(delta(2, [event(1, 'one'), event(2, 'two')]))
  expect(await refreshSessionReplay(channel, 's')).toBe(true)
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('onetwo')
  expect(useClaudeStore.getState().sessions.s.syncCursor).toEqual(cursor(2))
})

test('buffers live frames while pulling and deduplicates overlap', async () => {
  let finish!: (reply: SessionSyncReply) => void
  sync.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const pulling = refreshSessionReplay(channel, 's')
  receive({
    sessionId: 's',
    epoch: 'e',
    events: [event(1, 'A'), event(2, 'B')],
  })
  finish(delta(1, [event(1, 'A')]))
  expect(await pulling).toBe(true)
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('AB')
})

test('fills a missed sequence before accepting newer text', async () => {
  sync.mockResolvedValue(
    delta(3, [event(1, 'A'), event(2, 'B'), event(3, 'C')]),
  )
  receive({ sessionId: 's', epoch: 'e', events: [event(3, 'C')] })
  await flush()
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('ABC')
  expect(sync).toHaveBeenCalledTimes(1)
})

test('rejects a wrong-session batch without partially changing the view', async () => {
  sync.mockResolvedValue(delta(2, [event(1, 'A'), event(2, 'secret', 'other')]))
  expect(await refreshSessionReplay(channel, 's')).toBe(false)
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('')
  expect(useClaudeStore.getState().sessions.s.syncCursor).toEqual(cursor(0))
})

test('a reply from a previous profile cannot mutate the new profile', async () => {
  let finish!: (reply: SessionSyncReply) => void
  sync.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const pulling = refreshSessionReplay(channel, 's')
  useClaudeStore.setState({ scopeKey: 'different' })
  finish(delta(1, [event(1, 'private')]))
  expect(await pulling).toBe(false)
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('')
})

test('background suspension discards an in-flight reply and retries immediately on return', async () => {
  let finish!: (reply: SessionSyncReply) => void
  sync.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  sync.mockResolvedValue(delta(1, [event(1, 'A')]))
  useClaudeStore.getState().setActiveSession('s')
  change('background')
  receive({ sessionId: 's', epoch: 'e', events: [event(1, 'A')] })
  change('active')
  finish(delta(1, [event(1, 'A')]))
  await flush()
  expect(sync).toHaveBeenCalledTimes(2)
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('A')
})

test('expired unanchored snapshots retain history and request established transcript recovery', async () => {
  useClaudeStore.getState().handleHistory(
    's',
    [1, 2, 3].map(id => ({
      id: `old-${id}`,
      sessionId: 's',
      role: 'assistant',
      content: 'old',
      timestamp: 1,
    })),
  )
  sync.mockResolvedValue({
    mode: 'snapshot',
    sessionId: 's',
    cursor: cursor(10, 'new'),
    state: {
      messages: [
        {
          id: 'new',
          sessionId: 's',
          role: 'assistant',
          content: 'new',
          timestamp: 2,
        },
      ],
      isStreaming: false,
    },
  })
  expect(await refreshSessionReplay(channel, 's')).toBe(false)
  expect(useClaudeStore.getState().sessions.s.messages).toHaveLength(3)
})

test('pagination is ordered; a stalled page cannot loop forever', async () => {
  sync
    .mockResolvedValueOnce(delta(1, [event(1, 'A')], true))
    .mockResolvedValueOnce(delta(2, [event(2, 'B')]))
  expect(await refreshSessionReplay(channel, 's')).toBe(true)
  expect(sync).toHaveBeenLastCalledWith('s', cursor(1))
  sync.mockResolvedValue(delta(2, [], true))
  expect(await refreshSessionReplay(channel, 's')).toBe(false)
  expect(sync).toHaveBeenCalledTimes(3)
})

test('restores pending prompts, including authoritative clearing', async () => {
  const pending = { toolUseId: 'tool', toolName: 'Bash', input: {} }
  sync.mockResolvedValue({
    mode: 'snapshot',
    sessionId: 's',
    cursor: cursor(1),
    state: { messages: [], pendingPermission: pending },
  })
  await refreshSessionReplay(channel, 's')
  expect(useClaudeStore.getState().pendingPermission?.toolUseId).toBe('tool')
  sync.mockResolvedValue({
    mode: 'snapshot',
    sessionId: 's',
    cursor: cursor(2),
    state: { messages: [], pendingPermission: null },
  })
  await refreshSessionReplay(channel, 's')
  expect(useClaudeStore.getState().pendingPermission).toBeNull()
})

test('replayed completion retains its original server time instead of appearing newly completed', async () => {
  sync.mockResolvedValue(
    delta(2, [
      { ...event(1, 'done'), at: 100 },
      {
        seq: 2,
        at: 200,
        channel: 'claude:turn-end',
        params: { sessionId: 's' },
      },
    ] as never),
  )
  expect(await refreshSessionReplay(channel, 's')).toBe(true)
  const session = useClaudeStore.getState().sessions.s
  expect(session.lastCompletedAt).toBe(200)
  expect(session.lastDataAt).toBe(200)
  expect(session.messages[0].timestamp).toBe(200)
})

test('a failed sync enables legacy live updates and throttles repeated failures', async () => {
  expect(usesLegacySessionEvents(channel, 's')).toBe(false)
  sync.mockRejectedValue(new Error('moving checkpoint'))
  expect(await refreshSessionReplay(channel, 's')).toBe(false)
  expect(usesLegacySessionEvents(channel, 's')).toBe(true)
  for (let i = 0; i < 20; i++)
    receive({ sessionId: 's', epoch: 'e', events: [event(1, 'A')] })
  expect(sync).toHaveBeenCalledTimes(1)
})

test('a foreground refresh joins the fresh replay instead of reading an unsequenced snapshot', async () => {
  let finish!: (reply: SessionSyncReply) => void
  sync.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  sync.mockResolvedValue(delta(1, [event(1, 'once')]))
  useClaudeStore.getState().setActiveSession('s')
  change('background')
  change('active')
  const refreshing = refreshSessionReplay(channel, 's')
  finish(delta(1, [event(1, 'once')]))
  expect(await refreshing).toBe(true)
  expect(sync).toHaveBeenCalledTimes(2)
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('once')
})

test('a checkpoint distinguishes a missing runtime from an existing empty session', async () => {
  sync.mockResolvedValue({
    mode: 'snapshot',
    sessionId: 's',
    cursor: cursor(0),
    state: null,
  })
  await refreshSessionReplay(channel, 's')
  expect(useClaudeStore.getState().sessions.s.runtimeExists).toBe(false)
  sync.mockResolvedValue({
    mode: 'snapshot',
    sessionId: 's',
    cursor: cursor(1),
    state: { messages: [], isStreaming: false },
  })
  await refreshSessionReplay(channel, 's')
  expect(useClaudeStore.getState().sessions.s.runtimeExists).toBe(true)
})

function subscribeAll(newVersion: boolean) {
  stop?.()
  const callbacks: Record<string, (...args: any[]) => void> = {}
  for (const method of [
    'onMessage',
    'onToolUse',
    'onToolResult',
    'onStream',
    'onResult',
    'onTurnEnd',
    'onError',
    'onStatus',
    'onPermissionRequest',
    'onPermissionResolved',
    'onAskUser',
    'onAskUserResolved',
    'onHistory',
    'onModeChange',
    'onPromptSuggestion',
    'onSessionReset',
    'onUsage',
  ]) {
    Object.assign(channel, {
      [method]: (cb: (...args: any[]) => void) => {
        callbacks[method] = cb
        return () => {}
      },
    })
  }
  useConnectionStore.setState({
    client: { supportsMobileSync: newVersion } as never,
  })
  stop = subscribeClaudeEvents(channel)
  return callbacks
}

test('old hosts keep live events without invoking new replay RPCs', async () => {
  const callbacks = subscribeAll(false)
  useClaudeStore.getState().setActiveSession('s')
  callbacks.onStream('s', { text: 'old host' })
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('old host')
  expect(sync).not.toHaveBeenCalled()
})

test('new hosts ignore duplicate legacy deltas, but keep full history beyond the runtime snapshot tail', async () => {
  const callbacks = subscribeAll(true)
  receive({ sessionId: 's', epoch: 'e', events: [event(1, 'A')] })
  callbacks.onStream('s', { text: 'A' })
  expect(useClaudeStore.getState().sessions.s.streamingText).toBe('A')
  const history = Array.from({ length: 500 }, (_, id) => ({
    id: String(id),
    role: 'assistant',
    content: String(id),
    timestamp: 1,
  }))
  callbacks.onHistory('s', history)
  sync.mockResolvedValue({
    mode: 'snapshot',
    sessionId: 's',
    cursor: cursor(2),
    state: { messages: history.slice(-10), isStreaming: false },
  })
  await refreshSessionReplay(channel, 's')
  expect(useClaudeStore.getState().sessions.s.messages).toHaveLength(500)
})
