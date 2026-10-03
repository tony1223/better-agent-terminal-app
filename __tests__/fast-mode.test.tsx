import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Switch, Text } from 'react-native'
import { FastModeControl } from '../src/components/claude/FastModeControl'
import { useClaudeStore } from '../src/stores/claude-store'
import { useConnectionStore } from '../src/stores/connection-store'
import type { Channels } from '../src/api/channels'
import type { SessionMeta } from '../src/types'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function metadata(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    totalCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    numTurns: 0,
    contextWindow: 200000,
    model: 'claude-opus-5',
    fastMode: false,
    supportsFastMode: true,
    fastModeState: 'off',
    ...overrides,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
let renderer: Renderer.ReactTestRenderer
let channels: Channels
let setFastMode: jest.Mock
let getSessionMeta: jest.Mock
const currentMeta = () => useClaudeStore.getState().sessions.s?.meta
const toggle = () => renderer.root.findByType(Switch)
const text = () =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ')
async function render() {
  await act(async () => {
    renderer = Renderer.create(<FastModeControl sessionId="s" />)
  })
}
async function open() {
  await act(async () => {
    renderer.root.findByProps({ testID: 'fast-mode-control' }).props.onPress()
  })
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, scopeKey: 'a' })
  useClaudeStore.getState().handleStatus('s', metadata())
  setFastMode = jest
    .fn()
    .mockResolvedValue(metadata({ fastMode: true, fastModeState: 'pending' }))
  getSessionMeta = jest.fn().mockImplementation(async () => currentMeta())
  channels = { claude: { setFastMode, getSessionMeta } } as unknown as Channels
  useConnectionStore.setState({ channels, status: 'connected' })
})
afterEach(() => {
  if (renderer) act(() => renderer.unmount())
})

test.each(['off', 'pending', 'on', 'cooldown'])(
  'displays the host Fast state: %s',
  async state => {
    useClaudeStore
      .getState()
      .handleStatus(
        's',
        metadata({ fastMode: state !== 'off', fastModeState: state }),
      )
    await render()
    await open()
    expect(toggle().props.value).toBe(state !== 'off')
    expect(text()).toContain(`fastMode.${state}`)
    expect(text()).toContain(`fastMode.${state}Hint`)
    expect(setFastMode).not.toHaveBeenCalled()
  },
)

test('requires host acknowledgement and prevents duplicate toggles while saving', async () => {
  const reply = deferred<SessionMeta>()
  setFastMode.mockReturnValue(reply.promise)
  await render()
  await open()
  act(() => {
    void toggle().props.onValueChange(true)
    void toggle().props.onValueChange(true)
  })
  expect(setFastMode).toHaveBeenCalledTimes(1)
  expect(setFastMode).toHaveBeenCalledWith('s', true)
  expect(toggle().props.value).toBe(false)
  expect(toggle().props.disabled).toBe(true)
  await act(async () => {
    reply.resolve(metadata({ fastMode: true, fastModeState: 'pending' }))
  })
  expect(toggle().props.value).toBe(true)
  expect(text()).toContain('fastMode.pending')
})

test('host revocation updates the switch and displays the disabled reason', async () => {
  await render()
  await open()
  act(() =>
    useClaudeStore
      .getState()
      .handleStatus(
        's',
        metadata({ fastMode: true, fastModeState: 'cooldown' }),
      ),
  )
  expect(toggle().props.value).toBe(true)
  act(() =>
    useClaudeStore
      .getState()
      .handleStatus(
        's',
        metadata({ fastModeDisabledReason: 'Account unavailable' }),
      ),
  )
  expect(toggle().props.value).toBe(false)
  expect(text()).toContain('Account unavailable')
})

test.each([
  ['Enable Fast mode in host settings first.', 'fastMode.hostPolicy'],
  ['Fast mode requires BAT_DEBUG=1 on the host.', 'fastMode.hostPolicy'],
  ['This model does not support Fast mode.', 'fastMode.unsupported'],
  ['Method not found', 'fastMode.unavailable'],
])(
  'rejected Fast changes retain the host state: %s',
  async (message, expected) => {
    setFastMode.mockRejectedValue(new Error(message))
    await render()
    await open()
    await act(async () => {
      await toggle().props.onValueChange(true)
    })
    expect(toggle().props.value).toBe(false)
    expect(text()).toContain(expected)
    expect(toggle().props.disabled).toBe(false)
  },
)

test.each(['streaming', 'queued', 'unsupported', 'offline', 'old-host'])(
  'does not send Fast changes while %s',
  async reason => {
    if (reason === 'streaming')
      useClaudeStore
        .getState()
        .handleStatus('s', metadata({ isStreaming: true }))
    if (reason === 'queued')
      useClaudeStore
        .getState()
        .handleStatus('s', metadata({ runtimeStatus: 'queued' }))
    if (reason === 'unsupported')
      useClaudeStore
        .getState()
        .handleStatus('s', metadata({ supportsFastMode: false }))
    if (reason === 'offline')
      useConnectionStore.setState({ status: 'reconnecting' })
    if (reason === 'old-host')
      useClaudeStore
        .getState()
        .handleStatus(
          's',
          metadata({ fastMode: undefined, supportsFastMode: undefined }),
        )
    await render()
    await open()
    expect(toggle().props.disabled).toBe(true)
    await act(async () => {
      await toggle().props.onValueChange(true)
    })
    expect(setFastMode).not.toHaveBeenCalled()
    if (reason === 'old-host') expect(text()).toContain('fastMode.unknown')
  },
)

test('can turn Fast off without inheriting it in another session', async () => {
  useClaudeStore
    .getState()
    .handleStatus('s', metadata({ fastMode: true, fastModeState: 'on' }))
  setFastMode.mockResolvedValue(metadata())
  await render()
  await open()
  await act(async () => {
    await toggle().props.onValueChange(false)
  })
  expect(setFastMode).toHaveBeenCalledWith('s', false)
  expect(toggle().props.value).toBe(false)
  useClaudeStore.getState().initSession('new')
  expect(useClaudeStore.getState().sessions.new.meta?.fastMode).toBeUndefined()
})

test('a newer status broadcast wins over a late toggle acknowledgement', async () => {
  const reply = deferred<SessionMeta>()
  setFastMode.mockReturnValue(reply.promise)
  await render()
  await open()
  act(() => {
    void toggle().props.onValueChange(true)
  })
  act(() =>
    useClaudeStore
      .getState()
      .handleStatus('s', metadata({ fastModeDisabledReason: 'Revoked' })),
  )
  await act(async () => {
    reply.resolve(metadata({ fastMode: true, fastModeState: 'pending' }))
  })
  expect(toggle().props.value).toBe(false)
  expect(currentMeta()?.fastModeDisabledReason).toBe('Revoked')
})

test.each(['profile', 'reset', 'connection'])(
  'a late toggle cannot change the session after %s changes',
  async change => {
    const reply = deferred<SessionMeta>()
    setFastMode.mockReturnValue(reply.promise)
    await render()
    await open()
    act(() => {
      void toggle().props.onValueChange(true)
    })
    act(() => {
      if (change === 'profile')
        useClaudeStore.setState({ scopeKey: 'b', sessions: {} })
      if (change === 'connection')
        useConnectionStore.setState({ channels: { ...channels } })
      if (change === 'reset') useClaudeStore.getState().handleSessionReset('s')
    })
    await act(async () => {
      reply.resolve(metadata({ fastMode: true, fastModeState: 'pending' }))
    })
    expect(currentMeta()?.fastMode).not.toBe(true)
  },
)

test('opening settings refreshes host policy without overwriting a newer broadcast', async () => {
  const reply = deferred<SessionMeta>()
  getSessionMeta.mockReturnValue(reply.promise)
  await render()
  await open()
  expect(toggle().props.disabled).toBe(true)
  act(() =>
    useClaudeStore
      .getState()
      .handleStatus('s', metadata({ fastMode: true, fastModeState: 'on' })),
  )
  await act(async () => {
    reply.resolve(metadata())
  })
  expect(toggle().props.value).toBe(true)
  expect(text()).toContain('fastMode.on')
})

test('a malformed acknowledgement cannot turn Fast on', async () => {
  setFastMode.mockResolvedValue(true)
  await render()
  await open()
  await act(async () => {
    await toggle().props.onValueChange(true)
  })
  expect(toggle().props.value).toBe(false)
  expect(text()).toContain('fastMode.unavailable')
})

test('a host state read failure disables changes until authoritative status arrives', async () => {
  getSessionMeta.mockRejectedValue(new Error('Connection timed out'))
  await render()
  await open()
  expect(toggle().props.disabled).toBe(true)
  expect(text()).toContain('fastMode.unknown')
  act(() => useClaudeStore.getState().handleStatus('s', metadata()))
  expect(toggle().props.disabled).toBe(false)
})

test('a missing runtime cannot keep a cached Fast opt-in', async () => {
  useClaudeStore
    .getState()
    .handleStatus('s', metadata({ fastMode: true, fastModeState: 'on' }))
  getSessionMeta.mockResolvedValue(null)
  await render()
  await open()
  expect(toggle().props.disabled).toBe(true)
  expect(toggle().props.value).toBe(false)
  expect(currentMeta()?.fastMode).toBeUndefined()
})

test('a late toggle after leaving the screen cannot overwrite newer state', async () => {
  const reply = deferred<SessionMeta>()
  setFastMode.mockReturnValue(reply.promise)
  await render()
  await open()
  act(() => {
    void toggle().props.onValueChange(true)
    renderer.unmount()
  })
  await act(async () => {
    reply.resolve(metadata({ fastMode: true, fastModeState: 'pending' }))
  })
  expect(currentMeta()?.fastMode).toBe(false)
})

test('partial activity updates preserve Fast; explicit off and missing runtimes clear it', () => {
  const store = useClaudeStore.getState()
  store.handleStatus(
    's',
    metadata({
      fastMode: true,
      fastModeState: 'cooldown',
      fastModeDisabledReason: 'Rate limited',
    }),
  )
  store.handleStatus('s', { isStreaming: true } as SessionMeta)
  expect(currentMeta()?.fastModeState).toBe('cooldown')
  store.handleSessionState('s', { meta: { isStreaming: false } as SessionMeta })
  expect(currentMeta()?.fastMode).toBe(true)
  store.handleStatus('s', metadata({ fastModeDisabledReason: null }))
  expect(currentMeta()?.fastMode).toBe(false)
  expect(currentMeta()?.fastModeDisabledReason).toBeNull()
  store.handleRuntimeMissing('s')
  expect(currentMeta()?.fastMode).toBeUndefined()
})
