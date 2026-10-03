import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert, AppState, FlatList, Text, TouchableOpacity } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { getRecoveryDiagnostics, clearRecoveryDiagnostics } from '../src/utils/recovery-diagnostics'
import { ClaudeScreen } from '../src/screens/ClaudeScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useClaudeStore } from '../src/stores/claude-store'
import type { Channels } from '../src/api/channels'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-navigation/native', () => ({ useFocusEffect: jest.fn() }))
jest.mock('@/components/claude/ChatHistoryList', () => ({ ChatHistoryList: () => null }))
jest.mock('@/components/session/SessionContextBar', () => ({ SessionContextBar: () => null }))
jest.mock('@/components/session/SessionWorkspaceTabs', () => ({ SessionWorkspaceTabs: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/components/claude/FastModeControl', () => ({ FastModeControl: () => null }))

let renderer: Renderer.ReactTestRenderer | undefined
let channel: Record<string, jest.Mock>
const navigation = { setOptions: jest.fn(), navigate: jest.fn(), goBack: jest.fn() }
async function mount() {
  await act(async () => {
    renderer = Renderer.create(<ClaudeScreen route={{ params: { sessionId: 's' } } as any} navigation={navigation as any} />)
  })
}
beforeEach(() => {
  ;(useFocusEffect as jest.Mock).mockClear()
  clearRecoveryDiagnostics()
  jest.useFakeTimers()
  useClaudeStore.setState({ sessions: {}, activeSessionId: null, scopeKey: 'test' })
  channel = Object.fromEntries(['getSessionState', 'getSessionMeta', 'clientResume', 'resumeSession', 'startSession',
    'loadArchived', 'getSupportedEfforts', 'getSupportedCodexSandboxModes', 'getSupportedCodexApprovalPolicies']
    .map(name => [name, jest.fn().mockResolvedValue(null)]))
  useConnectionStore.setState({ status: 'connected', profileStatus: 'ready',
    client: { supportsProfileContext: true } as never, channels: { claude: channel } as unknown as Channels })
  useConnectionStore.setState({ checkConnection: jest.fn().mockResolvedValue(true) })
  useWorkspaceStore.setState({ workspaces: [], terminals: [
    { id: 's', workspaceId: 'w', type: 'terminal', title: 'Chat', cwd: '/project', sdkSessionId: 'sdk', agentPreset: 'codex-agent', scrollbackBuffer: [] },
  ], activeLocalProfileId: 'p', loadStatus: 'ok' })
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test.each(['Remote invoke timeout: agent:get-session-state', 'Connection closed', 'Profile selection changed'])(
  'a failed state read cannot authorize resume: %s', async message => {
    channel.getSessionState.mockRejectedValue(new Error(message))
    await mount()
    expect(channel.getSessionState).toHaveBeenCalled()
    expect(channel.clientResume).not.toHaveBeenCalled()
    expect(channel.resumeSession).not.toHaveBeenCalled()
    expect(channel.startSession).not.toHaveBeenCalled()
  },
)
test('an unreadable session without an SDK id cannot authorize a fresh start', async () => {
  useWorkspaceStore.setState({ terminals: useWorkspaceStore.getState().terminals.map(t => ({ ...t, sdkSessionId: undefined })) })
  channel.getSessionMeta.mockRejectedValue(new Error('Connection closed'))
  channel.getSessionState.mockRejectedValue(new Error('Connection closed'))
  await mount()
  expect(channel.startSession).not.toHaveBeenCalled()
})
test.each(['Remote invoke timeout: agent:client-resume', 'Connection closed', 'Profile selection changed'])(
  'a failed client resume does not trigger restarting fallback: %s', async message => {
    channel.clientResume.mockRejectedValue(new Error(message))
    await mount()
    expect(channel.clientResume).toHaveBeenCalledTimes(1)
    expect(channel.resumeSession).not.toHaveBeenCalled()
  },
)
test('a host explicitly missing client-resume can still use the legacy fallback', async () => {
  channel.clientResume.mockRejectedValue(new Error('sidecar(-32601): method not found: claude.clientResume'))
  await mount()
  expect(channel.resumeSession).toHaveBeenCalledTimes(1)
})
test('a streaming session is attached without any resume or start', async () => {
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: true })
  await mount()
  expect(channel.clientResume).not.toHaveBeenCalled()
  expect(channel.resumeSession).not.toHaveBeenCalled()
  expect(channel.startSession).not.toHaveBeenCalled()
})
test('a confirmed missing session without an SDK id can still be created', async () => {
  useWorkspaceStore.setState({ terminals: useWorkspaceStore.getState().terminals.map(t => ({ ...t, sdkSessionId: undefined })) })
  await mount()
  expect(channel.startSession).toHaveBeenCalledTimes(1)
  expect(channel.resumeSession).not.toHaveBeenCalled()
})
test('profile readiness defers loading and resumes it once ready', async () => {
  useConnectionStore.setState({ profileStatus: 'loading' })
  await mount()
  expect(channel.getSessionState).not.toHaveBeenCalled()
  expect(channel.clientResume).not.toHaveBeenCalled()
  await act(async () => { useConnectionStore.setState({ profileStatus: 'ready' }) })
  expect(channel.clientResume).toHaveBeenCalledTimes(1)
})
test('switching profiles during a state read must not resume on the old channel', async () => {
  let resolve!: (value: null) => void
  channel.getSessionState.mockImplementation(() => new Promise(res => { resolve = res }))
  await mount()
  await act(async () => {
    useConnectionStore.setState({ channels: null, profileStatus: 'loading' })
    resolve(null)
  })
  expect(channel.clientResume).not.toHaveBeenCalled()
  expect(channel.startSession).not.toHaveBeenCalled()
})

test.each(['metadata', 'archive'])('late %s data cannot mutate another profile', async source => {
  let finish!: (value: any) => void
  if (source === 'metadata') {
    useWorkspaceStore.setState({ terminals: useWorkspaceStore.getState().terminals.map(t => ({ ...t, sdkSessionId: undefined })) })
    channel.getSessionMeta.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  } else {
    channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: true })
    channel.loadArchived.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  }
  await mount()
  await act(async () => {
    useConnectionStore.setState({ channels: null, profileStatus: 'loading' })
    useClaudeStore.setState({ scopeKey: 'other', sessions: {} })
  })
  await act(async () => finish(source === 'metadata' ? { sdkSessionId: 'old-sdk', model: 'old-model' } :
    { messages: [{ id: 'old', role: 'assistant', content: 'wrong profile', timestamp: 1 }] }))
  expect(useClaudeStore.getState().sessions.s?.messages ?? []).toEqual([])
  expect(useClaudeStore.getState().sessions.s?.meta?.model).not.toBe('old-model')
  expect(channel.clientResume).not.toHaveBeenCalled()
})

test('duplicate foreground notifications share the same pending snapshot read', async () => {
  const listeners: Array<(state: string) => void> = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    listeners.push(cb as (state: string) => void)
    return { remove: jest.fn() }
  })
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: true })
  await mount()
  let blur!: () => void
  act(() => { blur = (useFocusEffect as jest.Mock).mock.calls.at(-1)[0]() })
  channel.getSessionState.mockClear()
  let finish!: (value: null) => void
  channel.getSessionState.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await act(async () => {
    listeners.forEach(cb => cb('active'))
    listeners.forEach(cb => cb('active'))
  })
  expect(channel.getSessionState).toHaveBeenCalledTimes(1)
  await act(async () => finish(null))
  const traces = getRecoveryDiagnostics().trim().split('\n').map(line => JSON.parse(line))
  const recoveries = traces.filter(event => event.event === 'chat.recover.end')
  expect(recoveries.length).toBeGreaterThan(0)
  expect(recoveries.every(event => event.outcome === 'deferred')).toBe(true)
  expect(channel.resumeSession).not.toHaveBeenCalled()
  act(() => blur())
})

test('a failed transcript repair retains history and is logged as incomplete', async () => {
  const listeners: Array<(state: string) => void> = []
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    listeners.push(cb as (state: string) => void)
    return { remove: jest.fn() }
  })
  const history = Array.from({ length: 200 }, (_, index) => ({ id: `old-${index}`, role: 'assistant' as const, content: `message ${index}`, timestamp: 1 }))
  channel.getSessionState.mockResolvedValue({ messages: history, isStreaming: false })
  await mount()
  let blur!: () => void
  act(() => { blur = (useFocusEffect as jest.Mock).mock.calls.at(-1)[0]() })
  channel.getSessionState.mockResolvedValue({ messages: [{ id: 'new', role: 'assistant', content: 'new', timestamp: 2 }], isStreaming: false })
  channel.clientResume.mockRejectedValue(new Error('Connection closed'))
  await act(async () => listeners.forEach(cb => cb('active')))
  const traces = getRecoveryDiagnostics().trim().split('\n').map(line => JSON.parse(line))
  expect(traces.filter(event => event.event === 'chat.recover.end').at(-1)).toMatchObject({ outcome: 'incomplete' })
  expect(useClaudeStore.getState().sessions.s.messages).toHaveLength(200)
  expect(channel.resumeSession).not.toHaveBeenCalled()
  act(() => blur())
})


test('resume uses live host permissions instead of App creation defaults', async () => {
  useWorkspaceStore.setState({ terminals: useWorkspaceStore.getState().terminals.map(t => ({
    ...t, agentParams: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' },
  })) })
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: false,
    codexSandboxMode: 'danger-full-access', codexApprovalPolicy: 'never' })
  await mount()
  expect(channel.clientResume).toHaveBeenCalledWith('s', 'sdk', '/project', undefined,
    expect.objectContaining({ codexSandboxMode: 'danger-full-access', codexApprovalPolicy: 'never' }))
})

test('fresh session uses explicitly selected workspace permissions including on-failure', async () => {
  useWorkspaceStore.setState({ terminals: useWorkspaceStore.getState().terminals.map(t => ({
    ...t, sdkSessionId: undefined, agentParams: { sandboxMode: 'read-only', approvalPolicy: 'on-failure' },
  })) })
  await mount()
  expect(channel.startSession).toHaveBeenCalledWith('s', expect.objectContaining({ codexSandboxMode: 'read-only', codexApprovalPolicy: 'on-failure' }))
})


async function chooseCodexSetting(kind: 'sandbox' | 'approval', value: string) {
  act(() => renderer!.root.findByProps({ accessibilityLabel: 'claude.controls.more' }).props.onPress())
  const label = kind === 'sandbox' ? 'claude.modal.actionSandbox' : 'claude.modal.actionApproval'
  const button = renderer!.root.findAllByType(TouchableOpacity).filter(node =>
    node.findAllByType(Text).some(text => text.props.children === label)).at(-1)!
  act(() => button.props.onPress())
  act(() => jest.advanceTimersByTime(250))
  const picker = renderer!.root.findAllByType(FlatList).find(node => node.props.data?.includes(value))!
  await act(async () => { await picker.props.renderItem({ item: value }).props.onPress() })
}

test.each([
  ['sandbox', 'setCodexSandboxMode', 'codexSandboxMode', 'danger-full-access'],
  ['approval', 'setCodexApprovalPolicy', 'codexApprovalPolicy', 'never'],
] as const)('acknowledged %s changes are retained for recovery', async (kind, method, field, value) => {
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: true })
  channel[method] = jest.fn().mockResolvedValue(true)
  await mount()
  await chooseCodexSetting(kind, value)
  expect(channel[method]).toHaveBeenCalledWith('s', value)
  expect(useClaudeStore.getState().sessions.s.meta?.[field]).toBe(value)
  act(() => renderer!.unmount())
  renderer = undefined
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: false })
  await mount()
  expect(channel.clientResume).toHaveBeenCalledWith('s', 'sdk', '/project', undefined, expect.objectContaining({ [field]: value }))
})

test.each([
  ['sandbox', 'setCodexSandboxMode', 'codexSandboxMode', 'danger-full-access'],
  ['approval', 'setCodexApprovalPolicy', 'codexApprovalPolicy', 'never'],
] as const)('a rejected %s change is not displayed as accepted', async (kind, method, field, value) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: true })
  channel[method] = jest.fn().mockResolvedValue(false)
  await mount()
  await chooseCodexSetting(kind, value)
  expect(useClaudeStore.getState().sessions.s.meta?.[field]).not.toBe(value)
  expect(alert).toHaveBeenCalled()
})
