import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert, TextInput } from 'react-native'
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
let renderer: Renderer.ReactTestRenderer
let channel: Record<string, jest.Mock>
const navigation = { setOptions: jest.fn(), navigate: jest.fn(), goBack: jest.fn() }
const action = () => renderer.root.findByProps({ testID: 'chat-action-reload' })
async function mount() {
  await act(async () => { renderer = Renderer.create(<ClaudeScreen route={{ params: { sessionId: 's' } } as any} navigation={navigation as any} />) })
}
const openActions = () => act(() => renderer.root.findByProps({ accessibilityLabel: 'claude.controls.more' }).props.onPress())
beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  useClaudeStore.setState({ sessions: {}, activeSessionId: null, scopeKey: 'test' })
  channel = Object.fromEntries(['getSessionState', 'getSessionMeta', 'clientResume', 'resumeSession', 'startSession',
    'loadArchived', 'getSupportedEfforts', 'getSupportedCodexSandboxModes', 'getSupportedCodexApprovalPolicies',
    'abortSession', 'stopSession', 'sendMessage', 'reloadSession'].map(name => [name, jest.fn().mockResolvedValue(null)]))
  channel.getSessionState.mockResolvedValue({ messages: [{ id: 'kept', role: 'user', content: 'Existing conversation', timestamp: 1 }],
    isStreaming: false, meta: { sdkSessionId: 'sdk', isStreaming: false, model: 'gpt-6.1-sol' } })
  channel.reloadSession.mockResolvedValue({ ok: true, sessionId: 's', sdkSessionId: 'sdk', deferred: true })
  useConnectionStore.setState({ status: 'connected', profileStatus: 'ready', client: { supportsProfileContext: true } as never,
    channels: { claude: channel } as unknown as Channels, checkConnection: jest.fn().mockResolvedValue(true) })
  useWorkspaceStore.setState({ workspaces: [], terminals: [{ id: 's', workspaceId: 'w', type: 'terminal', title: 'Chat',
    cwd: '/project', sdkSessionId: 'sdk', agentPreset: 'codex-agent', scrollbackBuffer: [] }], activeLocalProfileId: 'p', loadStatus: 'ok' })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); jest.useRealTimers(); jest.restoreAllMocks() })

test('the overflow action reloads the host after dismissing the sheet and preserves the conversation', async () => {
  await mount()
  openActions()
  expect(action().props.disabled).toBe(false)
  const messages = useClaudeStore.getState().sessions.s.messages
  act(() => action().props.onPress())
  expect(channel.reloadSession).not.toHaveBeenCalled()
  await act(async () => { jest.advanceTimersByTime(250) })
  expect(channel.reloadSession).toHaveBeenCalledWith('s')
  expect(channel.sendMessage).not.toHaveBeenCalled()
  expect(channel.stopSession).not.toHaveBeenCalled()
  expect(useClaudeStore.getState().sessions.s.messages).toBe(messages)
})

test.each(['/bat-reload', '/reload'])('the %s command does not send a model prompt', async command => {
  await mount()
  const input = () => renderer.root.findAllByType(TextInput).find(node => node.props.onSubmitEditing)!
  act(() => input().props.onChangeText(command))
  await act(async () => { await input().props.onSubmitEditing() })
  expect(channel.reloadSession).toHaveBeenCalledWith('s')
  expect(channel.sendMessage).not.toHaveBeenCalled()
  expect(input().props.value).toBe('')
})

test('the overflow action restarts during a host turn', async () => {
  channel.getSessionState.mockResolvedValue({ messages: [], isStreaming: true })
  await mount()
  openActions()
  expect(action().props.disabled).toBe(false)
  act(() => action().props.onPress())
  await act(async () => { jest.advanceTimersByTime(250) })
  expect(channel.reloadSession).toHaveBeenCalledWith('s')
  expect(channel.sendMessage).not.toHaveBeenCalled()
  expect(channel.stopSession).not.toHaveBeenCalled()
})
