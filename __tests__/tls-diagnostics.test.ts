const mockListeners = new Map<string, Set<(event: unknown) => void>>()
jest.mock('react-native', () => ({
  NativeModules: { TLSWebSocket: { connect: jest.fn(), close: jest.fn(), send: jest.fn() } },
  NativeEventEmitter: class {
    addListener(name: string, handler: (event: unknown) => void) {
      if (!mockListeners.has(name)) mockListeners.set(name, new Set())
      mockListeners.get(name)!.add(handler)
      return { remove: () => mockListeners.get(name)!.delete(handler) }
    }
  },
}))
import { TLSWebSocket } from '../src/native/tls-websocket'
import { NativeModules } from 'react-native'
import { clearRecoveryDiagnostics, getRecoveryDiagnostics } from '../src/utils/recovery-diagnostics'

test('native stage timings are correlated to the current socket and removed on close', () => {
  clearRecoveryDiagnostics()
  const socket = new TLSWebSocket()
  socket.connect('wss://host', 'fingerprint', {})
  const id = NativeModules.TLSWebSocket.connect.mock.calls.at(-1)![2]
  const emit = (connectionId: string, phase: string, elapsedMs: number) =>
    mockListeners.get('TLSWebSocket_onTiming')?.forEach(cb => cb({ connectionId, phase, elapsedMs }))
  emit('obsolete-connection', 'tcp-start', 1)
  emit(id, 'tcp-start', 2)
  emit(id, 'tls-start', 9320)
  socket.close()
  emit(id, 'tls-end', 9400)
  const events = getRecoveryDiagnostics().trim().split('\n').map(line => JSON.parse(line))
  expect(events.filter(event => event.event === 'socket.native.timing').map(event => [event.phase, event.elapsedMs])).toEqual([
    ['tcp-start', 2], ['tls-start', 9320],
  ])
  expect([...mockListeners.values()].every(set => set.size === 0)).toBe(true)
})
