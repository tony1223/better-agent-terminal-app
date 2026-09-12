import { AppState } from 'react-native'
import { subscribeWorkspaceShortcutActivity, workspaceActivityKey } from '../src/stores/workspace-shortcut-activity'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useClaudeStore } from '../src/stores/claude-store'

const target = (profileId: string, workspaceId = 'w') => ({ profileId, workspaceId })
const terminal = (id: string, workspaceId = 'w', agentPreset = 'codex-agent') => ({ id, workspaceId, agentPreset })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

let subscription: ReturnType<typeof subscribeWorkspaceShortcutActivity> | undefined
let appStateChange: (state: string) => void
let onSummary: jest.Mock
let invoke: jest.Mock
let read: jest.Mock
let client: any
const flush = () => jest.advanceTimersByTimeAsync(0)

beforeEach(() => {
  jest.useFakeTimers()
  onSummary = jest.fn()
  invoke = jest.fn(async (channel, params) => channel === 'profile:open'
    ? { contextId: `ctx-${params.profileId}`, profileId: params.profileId, status: 'ready' }
    : { ok: true })
  read = jest.fn(async (_contextId, channel) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: [terminal('same-id')] })
    : { isStreaming: true, runtimeStatus: null })
  client = {
    supportsProfileContext: true,
    invokeParams: invoke,
    scoped: jest.fn((contextId: string) => ({
      invokeParams: (channel: string, params: unknown) => read(contextId, channel, params),
    })),
  }
  useConnectionStore.setState({ status: 'connected', client, channels: {} as any, selectedProfileId: 'selected' })
  useWorkspaceStore.setState({ activeLocalProfileId: 'selected', terminals: [] })
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    appStateChange = callback as typeof appStateChange
    return { remove: jest.fn() }
  })
})

afterEach(() => {
  subscription?.dispose()
  subscription = undefined
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('unopened profiles with identical session IDs have independent running counts', async () => {
  read.mockImplementation(async (contextId, channel) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: [terminal('same-id')] })
    : { isStreaming: contextId === 'ctx-a', runtimeStatus: null })
  subscription = subscribeWorkspaceShortcutActivity([target('a'), target('b')], onSummary)
  await flush()
  expect(onSummary).toHaveBeenCalledWith(workspaceActivityKey(target('a')), { total: 1, working: 1 })
  expect(onSummary).toHaveBeenCalledWith(workspaceActivityKey(target('b')), { total: 1, working: 0 })
  expect(useConnectionStore.getState().selectedProfileId).toBe('selected')
  expect(useWorkspaceStore.getState().activeLocalProfileId).toBe('selected')
  expect(useWorkspaceStore.getState().terminals).toEqual([])
  expect(useClaudeStore.getState().sessions).toEqual({})
  expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['profile:open', 'profile:close', 'profile:open', 'profile:close'])
  expect(read.mock.calls.every(([, channel]) => ['workspace:load', 'agent:get-session-meta'].includes(channel))).toBe(true)
})

test('groups shortcuts in one profile and reads only their agent metadata', async () => {
  read.mockImplementation(async (_contextId, channel) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: [terminal('a'), terminal('b', 'other'), terminal('shell', 'w', 'none'), terminal('hidden', 'hidden')] })
    : { isStreaming: false, runtimeStatus: 'waiting_for_api' })
  subscription = subscribeWorkspaceShortcutActivity([target('a'), target('a', 'other')], onSummary)
  await flush()
  expect(invoke.mock.calls.filter(([channel]) => channel === 'profile:open')).toHaveLength(1)
  expect(read.mock.calls.filter(([, channel]) => channel === 'agent:get-session-meta').map(([, , params]) => params.sessionId)).toEqual(['a', 'b'])
  expect(onSummary).toHaveBeenCalledWith(workspaceActivityKey(target('a')), { total: 2, working: 1 })
  expect(onSummary).toHaveBeenCalledWith(workspaceActivityKey(target('a', 'other')), { total: 1, working: 1 })
})

test('polls without navigation, pauses in background, and refreshes immediately on foreground', async () => {
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  await flush()
  await jest.advanceTimersByTimeAsync(10_000)
  expect(onSummary).toHaveBeenCalledTimes(2)
  appStateChange('background')
  await jest.advanceTimersByTimeAsync(30_000)
  expect(onSummary).toHaveBeenCalledTimes(2)
  appStateChange('active')
  await flush()
  expect(onSummary).toHaveBeenCalledTimes(3)
})

test.each(['failed', 'usage-only', 'malformed'])('an unavailable read does not replace the badge with idle: %s', async outcome => {
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  await flush()
  read.mockImplementation(async (_contextId, channel) => {
    if (channel === 'workspace:load') return outcome === 'malformed' ? '{}' : JSON.stringify({ terminals: [terminal('same-id')] })
    if (outcome === 'failed') throw new Error('Disconnected')
    return { totalCost: 1 }
  })
  await jest.advanceTimersByTimeAsync(10_000)
  expect(onSummary).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenLastCalledWith('profile:close', { contextId: 'ctx-a' })
})

test('a missing runtime clears a previously working count', async () => {
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  await flush()
  read.mockImplementation(async (_contextId, channel) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: [terminal('same-id')] }) : null)
  await jest.advanceTimersByTimeAsync(10_000)
  expect(onSummary).toHaveBeenLastCalledWith(workspaceActivityKey(target('a')), { total: 1, working: 0 })
})

test.each(['dispose', 'profile-switch', 'disconnect'])('drops a late open and closes its temporary context after %s', async outcome => {
  const pending = deferred<any>()
  invoke.mockImplementation(async channel => channel === 'profile:open' ? pending.promise : { ok: true })
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  if (outcome === 'dispose') subscription.dispose()
  if (outcome === 'profile-switch') useConnectionStore.setState({ channels: {} as any })
  if (outcome === 'disconnect') useConnectionStore.setState({ status: 'reconnecting' })
  pending.resolve({ contextId: 'late', profileId: 'a', status: 'ready' })
  await flush()
  expect(read).not.toHaveBeenCalled()
  expect(onSummary).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenLastCalledWith('profile:close', { contextId: 'late' })
  await jest.advanceTimersByTimeAsync(30_000)
  expect(invoke).toHaveBeenCalledTimes(2)
})

test('late metadata from the previous connection cannot populate a new server', async () => {
  const pending = deferred<any>()
  read.mockImplementation(async (_contextId, channel) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: [terminal('same-id')] }) : pending.promise)
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  await flush()
  useConnectionStore.setState({ client: {} as any })
  pending.resolve({ isStreaming: true })
  await flush()
  expect(onSummary).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenLastCalledWith('profile:close', { contextId: 'ctx-a' })
})

test('metadata concurrency is bounded and repeated refreshes do not overlap sweeps', async () => {
  const pending = Array.from({ length: 5 }, () => deferred<any>())
  read.mockImplementation(async (_contextId, channel, params) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: pending.map((_, index) => terminal(String(index))) }) : pending[Number(params.sessionId)].promise)
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  await flush()
  const refreshing = subscription.refresh()
  expect(read.mock.calls.filter(([, channel]) => channel === 'agent:get-session-meta')).toHaveLength(3)
  pending[0].resolve({ isStreaming: true })
  await flush()
  expect(read.mock.calls.filter(([, channel]) => channel === 'agent:get-session-meta')).toHaveLength(4)
  subscription.dispose()
  for (const operation of pending) operation.resolve({ isStreaming: true })
  await refreshing
  expect(onSummary).not.toHaveBeenCalled()
  expect(invoke.mock.calls.filter(([channel]) => channel === 'profile:open')).toHaveLength(1)
})

test('legacy hosts are not queried through an unscoped execution fallback', async () => {
  client.supportsProfileContext = false
  subscription = subscribeWorkspaceShortcutActivity([target('a')], onSummary)
  await flush()
  expect(invoke).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})
