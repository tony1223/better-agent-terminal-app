import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert, View } from 'react-native'
import { useSessionReload } from '../src/hooks/useSessionReload'
import { useClaudeStore } from '../src/stores/claude-store'
import { useConnectionStore } from '../src/stores/connection-store'
import type { Channels } from '../src/api/channels'
import type { SessionMeta } from '../src/types'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
function Harness() {
  const action = useSessionReload('s')
  return <View testID="reload" onTouchEnd={action.reload} accessibilityState={{ disabled: action.disabled, busy: action.pending }} />
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}
const metadata: SessionMeta = { totalCost: 2, inputTokens: 123, outputTokens: 4, durationMs: 1,
  numTurns: 3, contextWindow: 1000000, model: 'gpt-6.1-sol', sdkSessionId: 'kept', isStreaming: false,
  fastMode: true, supportsFastMode: true, fastModeState: 'on' }
let renderer: Renderer.ReactTestRenderer
let reloadSession: jest.Mock
let alert: jest.SpyInstance
const button = () => renderer.root.findByProps({ testID: 'reload' })
const invoke = async () => { await act(async () => { await button().props.onTouchEnd() }) }
const render = async () => { await act(async () => { renderer = Renderer.create(<Harness />) }) }
beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, scopeKey: 'a' })
  useClaudeStore.getState().handleMessage('s', { id: 'kept', sessionId: 's', role: 'user', content: 'history', timestamp: 1 })
  useClaudeStore.getState().handleStatus('s', metadata)
  reloadSession = jest.fn().mockResolvedValue({ ok: true, sessionId: 's', sdkSessionId: 'kept', deferred: false })
  useConnectionStore.setState({ channels: { claude: { reloadSession } } as unknown as Channels, status: 'connected' })
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); alert.mockRestore() })

test.each([false, true])('reports canonical reload result deferred=%s and preserves history and Fast', async deferredResult => {
  reloadSession.mockResolvedValue({ ok: true, sessionId: 's', sdkSessionId: 'kept', deferred: deferredResult })
  await render()
  const before = useClaudeStore.getState().sessions.s
  await invoke()
  expect(reloadSession).toHaveBeenCalledTimes(1)
  expect(reloadSession).toHaveBeenCalledWith('s')
  expect(useClaudeStore.getState().sessions.s).toBe(before)
  expect(alert).toHaveBeenCalledWith('reloadSession.title', deferredResult ? 'reloadSession.nextTurn' : 'reloadSession.complete')
})

test('an active host turn can restart; a disconnected client cannot', async () => {
  useClaudeStore.getState().handleStatus('s', { ...metadata, isStreaming: true, runtimeStatus: 'waiting_for_api' })
  await render()
  expect(button().props.accessibilityState.disabled).toBe(false)
  await invoke()
  expect(reloadSession).toHaveBeenCalledTimes(1)
  // The hook waits for canonical host events to end the old turn.
  expect(useClaudeStore.getState().sessions.s.isStreaming).toBe(true)
  act(() => useConnectionStore.setState({ status: 'disconnected' }))
  await invoke()
  expect(reloadSession).toHaveBeenCalledTimes(1)
})

test('a restart already requested by another client cannot be duplicated', async () => {
  useClaudeStore.getState().handleStatus('s', { ...metadata, runtimeStatus: 'reloading' })
  await render()
  expect(button().props.accessibilityState.disabled).toBe(true)
  await invoke()
  expect(reloadSession).not.toHaveBeenCalled()
  expect(alert).toHaveBeenCalledWith('reloadSession.title', 'reloadSession.busy')
})

test('duplicate taps are coalesced and shared reload status settles without clearing the transcript', async () => {
  const reply = deferred<unknown>()
  reloadSession.mockReturnValue(reply.promise)
  await render()
  let pending!: Promise<void>
  act(() => { pending = button().props.onTouchEnd() })
  expect(button().props.accessibilityState.busy).toBe(true)
  await invoke()
  expect(reloadSession).toHaveBeenCalledTimes(1)
  act(() => useClaudeStore.getState().handleStatus('s', { ...metadata, runtimeStatus: 'reloading' }))
  act(() => useClaudeStore.getState().handleStatus('s', { ...metadata, runtimeStatus: null }))
  await act(async () => { reply.resolve({ ok: true, sessionId: 's', deferred: true }); await pending })
  expect(button().props.accessibilityState.disabled).toBe(false)
  expect(useClaudeStore.getState().sessions.s.messages[0]).toMatchObject({ id: 'kept', content: 'history' })
  expect(useClaudeStore.getState().sessions.s.meta?.fastMode).toBe(true)
})

test('old hosts show an update hint and failed reloads can be retried', async () => {
  reloadSession.mockRejectedValueOnce(new Error('method not found'))
  await render()
  await invoke()
  expect(alert).toHaveBeenCalledWith('reloadSession.failed', 'reloadSession.unavailable')
  expect(button().props.accessibilityState.busy).toBe(false)
  await invoke()
  expect(reloadSession).toHaveBeenCalledTimes(2)
})

test('unconfirmed reload must not report success', async () => {
  reloadSession.mockResolvedValue({ ok: false })
  await render()
  await invoke()
  expect(alert).toHaveBeenCalledWith('reloadSession.failed', expect.stringContaining('reloadSession.unavailable'))
})

test('a late acknowledgement from a previous host cannot affect the selected profile', async () => {
  const reply = deferred<unknown>()
  reloadSession.mockReturnValue(reply.promise)
  await render()
  let pending!: Promise<void>
  act(() => { pending = button().props.onTouchEnd() })
  act(() => {
    useClaudeStore.setState({ sessions: {}, scopeKey: 'b' })
    useClaudeStore.getState().handleMessage('s', { id: 'new-host', sessionId: 's', role: 'user', content: 'other host', timestamp: 2 })
    useConnectionStore.setState({ channels: {} as Channels })
  })
  const selected = useClaudeStore.getState().sessions.s
  await act(async () => { reply.resolve({ ok: true, sessionId: 's', deferred: false }); await pending })
  expect(alert).not.toHaveBeenCalled()
  expect(useClaudeStore.getState().sessions.s).toBe(selected)
  expect(button().props.accessibilityState.busy).toBe(false)
})
