import { useConnectionStore } from '../src/stores/connection-store'
import { useClaudeStore, registerSessionRecovery } from '../src/stores/claude-store'
import { subscribeMessageReconnectRetry } from '../src/stores/message-reconnect-retry'
import type { ClaudeMessage } from '../src/types'

const payload = { messageText: 'first line\nsecond line', images: ['data:image/png;base64,test'] }
const sessionId = 'session'
let host: string
let scope: string
let sequence = 0
let send: jest.Mock
let unsubscribe: () => void
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const message = () => useClaudeStore.getState().sessions[sessionId]?.messages.find(m => m.id === 'user-local-1') as ClaudeMessage | undefined
const seed = () => useClaudeStore.getState().handleMessage(sessionId, {
  id: 'user-local-1', sessionId, role: 'user', content: payload.messageText,
  timestamp: Date.now(), status: 'sending', sendPayload: payload,
})
const deliver = () => useClaudeStore.getState().deliverUserMessage(sessionId, 'user-local-1', payload)
const connect = () => useConnectionStore.setState({ status: 'connected' })

beforeEach(() => {
  host = `retry-host-${++sequence}`
  scope = `${host}:9876/legacy`
  useClaudeStore.getState().switchScope(scope)
  useClaudeStore.setState({ sessions: {} })
  send = jest.fn().mockResolvedValue({ ok: true })
  useConnectionStore.setState({ host, port: 9876, status: 'disconnected',
    client: { supportsProfileContext: false, isConnected: true } as any,
    channels: { claude: { sendMessage: send } } as any, profileContext: null, profileStatus: 'idle' })
  unsubscribe = subscribeMessageReconnectRetry()
})
afterEach(() => { unsubscribe(); jest.restoreAllMocks() })

test('offline send is retained, then sent exactly once with original text/images on reconnect', async () => {
  seed()
  await deliver()
  expect(send).not.toHaveBeenCalled()
  expect(message()).toMatchObject({ status: 'failed', reconnectRetry: 'pending', sendPayload: payload })
  connect()
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(sessionId, payload.messageText, payload.images)
  expect(message()).toMatchObject({ status: 'sent', reconnectRetry: 'used' })
  useConnectionStore.setState({ status: 'disconnected' })
  connect()
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
})

test('a failed automatic retry never re-arms; manual retry remains available', async () => {
  seed()
  await deliver()
  send.mockRejectedValueOnce(new Error('Not connected to remote server'))
  connect()
  await flush()
  expect(message()).toMatchObject({ status: 'failed', reconnectRetry: 'used', failureReason: 'Not connected to remote server' })
  for (let i = 0; i < 3; i++) {
    useConnectionStore.setState({ status: 'disconnected' })
    connect()
    await flush()
  }
  expect(send).toHaveBeenCalledTimes(1)
  useClaudeStore.getState().retryUserMessage(sessionId, 'user-local-1')
  await flush()
  expect(send).toHaveBeenCalledTimes(2)
  expect(message()?.status).toBe('sent')
})

test('manual retry before the scheduled automatic retry does not send twice', async () => {
  seed()
  await deliver()
  connect()
  useClaudeStore.getState().retryUserMessage(sessionId, 'user-local-1')
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
})

test('an automatic attempt does not also perform the existing no-cwd resend', async () => {
  const recover = jest.fn()
  const removeRecovery = registerSessionRecovery(sessionId, recover)
  seed()
  await deliver()
  send.mockRejectedValue(new Error('session has no cwd; startSession must be called with options.cwd'))
  connect()
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
  expect(recover).not.toHaveBeenCalled()
  expect(message()).toMatchObject({ status: 'failed', reconnectRetry: 'used' })
  removeRecovery()
})

test.each(['Connection closed', 'Remote invoke timeout: agent:send-message', 'Permission denied'])(
  'does not auto-resend an ambiguous or host-rejected send: %s', async error => {
    connect()
    send.mockRejectedValueOnce(new Error(error))
    seed()
    await deliver()
    useConnectionStore.setState({ status: 'disconnected' })
    connect()
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(message()).toMatchObject({ status: 'failed', failureReason: error })
    expect(message()?.reconnectRetry).toBeUndefined()
  },
)

test('a pre-send transport rejection waits for the socket to actually recover', async () => {
  connect()
  seed()
  send.mockImplementationOnce(() => {
    useConnectionStore.setState({ client: { supportsProfileContext: false, isConnected: false } as any })
    return Promise.reject(new Error('Not connected to remote server'))
  })
  await deliver()
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
  expect(message()?.reconnectRetry).toBe('pending')
  useConnectionStore.setState({ client: { supportsProfileContext: false, isConnected: true } as any })
  await flush()
  expect(send).toHaveBeenCalledTimes(2)
})

test('profile loading/unavailable waits for the original remote binding, not just connected', async () => {
  scope = `${host}:9876/remote-a`
  useClaudeStore.getState().switchScope(scope)
  useConnectionStore.setState({ status: 'connected', client: { supportsProfileContext: true } as any, profileStatus: 'loading' })
  seed()
  await deliver()
  await flush()
  expect(send).not.toHaveBeenCalled()
  useConnectionStore.setState({ profileStatus: 'unavailable' })
  await flush()
  expect(send).not.toHaveBeenCalled()
  useConnectionStore.setState({ profileStatus: 'ready', profileContext: { contextId: 'b', profileId: 'b', bindingKey: 'remote-b', name: 'B', status: 'ready' } })
  await flush()
  expect(send).not.toHaveBeenCalled()
  useConnectionStore.setState({ profileContext: { contextId: 'a', profileId: 'a', bindingKey: 'remote-a', name: 'A', status: 'ready' } })
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
})

test('another server with the same session ID cannot receive a queued message', async () => {
  seed()
  await deliver()
  useConnectionStore.setState({ host: 'different-server', status: 'connected' })
  await flush()
  expect(send).not.toHaveBeenCalled()
  useClaudeStore.getState().switchScope('different-server:9876/legacy')
  await flush()
  expect(send).not.toHaveBeenCalled()
  useConnectionStore.setState({ host })
  useClaudeStore.getState().switchScope(scope)
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
})

test('a host echo merged before retry cancels the queued copy', async () => {
  seed()
  await deliver()
  connect()
  useClaudeStore.getState().handleHistory(sessionId, [{
    id: 'host-echo', sessionId, role: 'user', content: payload.messageText, timestamp: Date.now(),
  }])
  await flush()
  expect(send).not.toHaveBeenCalled()
  expect(message()).toBeUndefined()
})

test('cleanup cancels a scheduled retry', async () => {
  seed()
  await deliver()
  connect()
  unsubscribe()
  await flush()
  expect(send).not.toHaveBeenCalled()
})

test('another drop during retry does not consume later queued messages', async () => {
  seed()
  await deliver()
  useClaudeStore.getState().handleMessage('second-session', {
    id: 'user-local-2', sessionId: 'second-session', role: 'user', content: 'second',
    timestamp: Date.now(), status: 'failed', reconnectRetry: 'pending', sendPayload: { messageText: 'second' },
  })
  send.mockImplementationOnce(() => {
    useConnectionStore.setState({ status: 'disconnected' })
    return Promise.reject(new Error('Connection closed'))
  })
  connect()
  await flush()
  expect(send).toHaveBeenCalledTimes(1)
  expect(useClaudeStore.getState().sessions['second-session'].messages[0]).toMatchObject({ reconnectRetry: 'pending', status: 'failed' })
  connect()
  await flush()
  expect(send).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenLastCalledWith('second-session', 'second', undefined)
})
