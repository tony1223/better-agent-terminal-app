import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { useConnectionStore } from '../src/stores/connection-store'
import { useSupportedSessionTypes } from '../src/hooks/use-supported-session-types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function mockChannels(ids = ['codex-agent']) {
  return {
    agent: {
      listPresets: jest.fn().mockResolvedValue(ids),
      getSupportedSessionTypes: jest.fn().mockResolvedValue(['claude-code']),
    },
  }
}

let result: ReturnType<typeof useSupportedSessionTypes>
let renderer: ReactTestRenderer.ReactTestRenderer
let alert: jest.SpyInstance

function Harness() {
  result = useSupportedSessionTypes('Unable to load session types')
  return null
}

async function mount() {
  await act(async () => { renderer = ReactTestRenderer.create(<Harness />) })
}

beforeEach(() => {
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  useConnectionStore.setState({
    client: { supportsProfileContext: true } as any,
    status: 'connected',
    profileStatus: 'ready',
    channels: mockChannels() as any,
  })
})

afterEach(() => {
  if (renderer) act(() => renderer.unmount())
  alert.mockRestore()
})

test('waits for the profile, then reloads quietly after a reconnect', async () => {
  const unavailable = mockChannels()
  unavailable.agent.listPresets.mockRejectedValue(new Error('Profile is not ready'))
  useConnectionStore.setState({ profileStatus: 'idle', channels: unavailable as any })
  await mount()
  await act(async () => { await result.loadSupportedSessionTypes() })
  await act(async () => { useConnectionStore.setState({ profileStatus: 'loading' }) })
  expect(unavailable.agent.listPresets).not.toHaveBeenCalled()

  const ready = mockChannels()
  await act(async () => {
    useConnectionStore.setState({ profileStatus: 'ready', channels: ready as any })
  })
  expect(result.availableSessionTypes?.map(type => type.id)).toEqual(['codex-agent'])

  await act(async () => {
    useConnectionStore.setState({ status: 'reconnecting', profileStatus: 'idle' })
  })
  await act(async () => {
    useConnectionStore.setState({ status: 'connected', channels: unavailable as any })
  })
  expect(unavailable.agent.listPresets).not.toHaveBeenCalled()
  expect(result.availableSessionTypes?.map(type => type.id)).toEqual(['codex-agent'])
  await act(async () => {
    useConnectionStore.setState({ profileStatus: 'ready', channels: ready as any })
  })
  expect(ready.agent.listPresets).toHaveBeenCalledTimes(2)
  expect(alert).not.toHaveBeenCalled()
})

test('legacy hosts load without profile readiness and keep the endpoint fallback', async () => {
  const channels = mockChannels()
  channels.agent.listPresets.mockRejectedValue(new Error('Unknown channel'))
  useConnectionStore.setState({
    client: { supportsProfileContext: false } as any,
    profileStatus: 'idle', channels: channels as any,
  })
  await mount()
  expect(channels.agent.getSupportedSessionTypes).toHaveBeenCalledTimes(1)
  expect(result.availableSessionTypes?.map(type => type.id)).toEqual(['claude-code'])
  expect(alert).not.toHaveBeenCalled()
})

test.each(['Profile is not ready', 'Profile selection changed', 'Profile connection changed',
  'Not connected to remote server', 'Connection closed'])('ignores transient error: %s', async message => {
  const channels = mockChannels()
  channels.agent.listPresets.mockRejectedValue(new Error(message))
  useConnectionStore.setState({ channels: channels as any })
  await mount()
  expect(channels.agent.getSupportedSessionTypes).not.toHaveBeenCalled()
  expect(result.availableSessionTypes).toBeNull()
  expect(result.loadingTypes).toBe(false)
  expect(alert).not.toHaveBeenCalled()
})

test.each(['resolve', 'reject'] as const)('ignores a stale fallback that finishes with %s after recovery', async outcome => {
  const old = mockChannels([])
  const pending = deferred<string[]>()
  old.agent.getSupportedSessionTypes.mockReturnValue(pending.promise)
  useConnectionStore.setState({ channels: old as any })
  await mount()
  expect(old.agent.getSupportedSessionTypes).toHaveBeenCalledTimes(1)

  await act(async () => {
    useConnectionStore.setState({ channels: mockChannels() as any })
  })
  await act(async () => {
    if (outcome === 'resolve') pending.resolve(['claude-code'])
    else pending.reject(new Error('Profile is not ready'))
  })
  expect(result.availableSessionTypes?.map(type => type.id)).toEqual(['codex-agent'])
  expect(result.loadingTypes).toBe(false)
  expect(alert).not.toHaveBeenCalled()
})

test('does not alert or call the fallback after unmount', async () => {
  const channels = mockChannels()
  const pending = deferred<string[]>()
  channels.agent.listPresets.mockReturnValue(pending.promise)
  useConnectionStore.setState({ channels: channels as any })
  await mount()
  act(() => renderer.unmount())
  await act(async () => { pending.reject(new Error('Unknown channel')) })
  expect(channels.agent.getSupportedSessionTypes).not.toHaveBeenCalled()
  expect(alert).not.toHaveBeenCalled()
})

test('still reports a current non-transient failure', async () => {
  const channels = mockChannels([])
  channels.agent.getSupportedSessionTypes.mockRejectedValue(new Error('Access denied'))
  useConnectionStore.setState({ channels: channels as any })
  await mount()
  expect(alert).toHaveBeenCalledWith('Unable to load session types', 'Error: Access denied')
  expect(result.loadingTypes).toBe(false)
})
