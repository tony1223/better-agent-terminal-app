import { AppState } from 'react-native'
import { subscribeSessionActivity } from '../src/stores/session-activity-sync'
import { useClaudeStore } from '../src/stores/claude-store'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { deriveAgentActivity } from '../src/utils/session-status'
import type { ClaudeChannel } from '../src/api/channels/claude'
import type { Channels } from '../src/api/channels'
import type { SessionMeta, TerminalInstance } from '../src/types'

const meta = (fields: Partial<SessionMeta>) => ({ totalCost: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, numTurns: 0, contextWindow: 0, ...fields })
const terminal = (id: string, agentPreset = 'codex-agent') => ({ id, workspaceId: 'w', type: 'terminal', title: id, cwd: '/', scrollbackBuffer: [], agentPreset } as TerminalInstance)
let stop: (() => void) | undefined
let appStateChange: (state: string) => void
let getMeta: jest.Mock
let channel: ClaudeChannel
beforeEach(() => {
  jest.useFakeTimers()
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  useWorkspaceStore.setState({ terminals: [terminal('s')] })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    appStateChange = callback as typeof appStateChange
    return { remove: jest.fn() }
  })
  getMeta = jest.fn().mockResolvedValue(meta({ isStreaming: true, runtimeStatus: null, lastDataAt: 1000 }))
  channel = { getSessionMeta: getMeta } as unknown as ClaudeChannel
  useConnectionStore.setState({ channels: { claude: channel } as Channels })
})
afterEach(() => { stop?.(); stop = undefined; jest.useRealTimers(); jest.restoreAllMocks() })
const flush = () => jest.advanceTimersByTimeAsync(0)

test('an already-running quiet session is recognised before it has been opened', async () => {
  stop = subscribeSessionActivity(channel)
  await flush()
  expect(getMeta).toHaveBeenCalledWith('s')
  expect(useClaudeStore.getState().activeSessionId).toBeNull()
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
  expect(useClaudeStore.getState().sessions.s.messages).toEqual([])
  expect(useClaudeStore.getState().sessions.s.lastDataAt).toBe(1000)
})

test('metadata corrects missed turn end without erasing partial output or inventing completion time', async () => {
  useClaudeStore.getState().handleStream('s', { text: 'partial' })
  getMeta.mockResolvedValue(meta({ isStreaming: false, runtimeStatus: null, lastDataAt: 1234 }))
  stop = subscribeSessionActivity(channel)
  await flush()
  const session = useClaudeStore.getState().sessions.s
  expect(deriveAgentActivity(session)).toBe('idle')
  expect(session.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'partial' })]))
  expect(session.lastCompletedAt).toBeNull()
  await jest.advanceTimersByTimeAsync(10_000)
  expect(useClaudeStore.getState().sessions.s.lastDataAt).toBe(1234)
})

test('host restart clears a stale working badge when the runtime is explicitly missing', async () => {
  useClaudeStore.getState().handleStatus('s', meta({ isStreaming: true, runtimeStatus: 'queued', lastDataAt: 1000 }))
  useClaudeStore.getState().handleStream('s', { text: 'reply received before BAT restarted' })
  getMeta.mockResolvedValue(null)
  stop = subscribeSessionActivity(channel)
  await flush()
  const session = useClaudeStore.getState().sessions.s
  expect(deriveAgentActivity(session)).toBe('idle')
  expect(session.isStreaming).toBe(false)
  expect(session.turnStartedAt).toBeNull()
  expect(session.meta?.runtimeStatus).toBeNull()
  expect(session.lastCompletedAt).toBeNull()
  expect(session.lastDataAt).toBe(1000)
  expect(session.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'reply received before BAT restarted' })]))
})

test('a missing response cannot clear newer live output that arrived during the probe', async () => {
  let finish!: (value: null) => void
  getMeta.mockReturnValue(new Promise(resolve => { finish = resolve }))
  stop = subscribeSessionActivity(channel)
  useClaudeStore.getState().handleStream('s', { text: 'new live output' })
  finish(null)
  await flush()
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
})

test('failed probes and usage-only replies do not masquerade as a missing runtime', async () => {
  useClaudeStore.getState().handleStream('s', { text: 'running' })
  getMeta.mockRejectedValueOnce(new Error('remote profile disconnected')).mockResolvedValue(meta({}))
  stop = subscribeSessionActivity(channel)
  await flush()
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
  await jest.advanceTimersByTimeAsync(10_000)
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
})

test('remote work remains active even if its last output was yesterday', async () => {
  getMeta.mockResolvedValue(meta({ isStreaming: true, runtimeStatus: null, lastDataAt: Date.now() - 86_400_000 }))
  stop = subscribeSessionActivity(channel)
  await flush()
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
})

test('missing runtime while a local send is pending does not cancel the starting turn', async () => {
  useClaudeStore.getState().handleStatus('s', meta({ runtimeStatus: 'starting' }))
  useClaudeStore.getState().handleMessage('s', { id: 'pending', sessionId: 's', role: 'user', content: 'start', timestamp: Date.now(), status: 'sending' })
  getMeta.mockResolvedValue(null)
  stop = subscribeSessionActivity(channel)
  await flush()
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
})

test('late idle metadata cannot override a newer stream but can advance host output time', async () => {
  let finish!: (value: SessionMeta) => void
  getMeta.mockReturnValue(new Promise(resolve => { finish = resolve }))
  stop = subscribeSessionActivity(channel)
  useClaudeStore.getState().handleStream('s', { thinking: 'new' })
  finish(meta({ isStreaming: false, runtimeStatus: null, lastDataAt: 1500 }))
  await flush()
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
  expect(useClaudeStore.getState().sessions.s.lastDataAt).toBe(1500)
})

test('usage-only metadata from old hosts does not clear a waiting phase', async () => {
  useClaudeStore.getState().handleStatus('s', meta({ runtimeStatus: 'queued' }))
  getMeta.mockResolvedValue(meta({}))
  stop = subscribeSessionActivity(channel)
  await flush()
  expect(useClaudeStore.getState().sessions.s.meta?.runtimeStatus).toBe('queued')
  expect(deriveAgentActivity(useClaudeStore.getState().sessions.s)).toBe('working')
})

test('foreign profile responses are discarded, and deleted sessions are not resurrected', async () => {
  let finish!: (value: SessionMeta) => void
  getMeta.mockReturnValue(new Promise(resolve => { finish = resolve }))
  stop = subscribeSessionActivity(channel)
  useConnectionStore.setState({ channels: { claude: {} } as Channels })
  useWorkspaceStore.setState({ terminals: [] })
  finish(meta({ isStreaming: true, lastDataAt: 1500 }))
  await flush()
  expect(useClaudeStore.getState().sessions.s).toBeUndefined()
})

test('background pauses polling; foreground and newly discovered sessions refresh immediately', async () => {
  stop = subscribeSessionActivity(channel)
  await flush()
  appStateChange('background')
  await jest.advanceTimersByTimeAsync(30_000)
  expect(getMeta).toHaveBeenCalledTimes(1)
  appStateChange('active')
  await flush()
  expect(getMeta).toHaveBeenCalledTimes(2)
  useWorkspaceStore.setState({ terminals: [terminal('s'), terminal('new'), terminal('shell', 'none')] })
  await flush()
  expect(getMeta).toHaveBeenCalledWith('new')
  expect(getMeta).not.toHaveBeenCalledWith('shell')
})

test('sweeps are single flight and cap concurrent metadata calls at three', async () => {
  const finishes: Array<(value: SessionMeta) => void> = []
  getMeta.mockImplementation(() => new Promise(resolve => { finishes.push(resolve) }))
  useWorkspaceStore.setState({ terminals: Array.from({ length: 8 }, (_, index) => terminal(String(index))) })
  stop = subscribeSessionActivity(channel)
  expect(getMeta).toHaveBeenCalledTimes(3)
  appStateChange('active')
  expect(getMeta).toHaveBeenCalledTimes(3)
  finishes[0](meta({ isStreaming: false }))
  await flush()
  expect(getMeta).toHaveBeenCalledTimes(4)
})

test('host time is monotonic, and unknown differs from an explicit no-data response', () => {
  expect(useClaudeStore.getState().sessions.s?.lastDataAt).toBeUndefined()
  useClaudeStore.getState().handleLastDataAt('s', null)
  expect(useClaudeStore.getState().sessions.s.lastDataAt).toBeNull()
  useClaudeStore.getState().handleLastDataAt('s', 2000)
  useClaudeStore.getState().handleLastDataAt('s', 1000)
  useClaudeStore.getState().handleLastDataAt('s', null)
  expect(useClaudeStore.getState().sessions.s.lastDataAt).toBe(2000)
})
