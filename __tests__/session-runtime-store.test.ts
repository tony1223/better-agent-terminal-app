import { useSessionRuntimeStore } from '../src/stores/session-runtime-store'
import { useConnectionStore } from '../src/stores/connection-store'

jest.mock('../src/stores/connection-store', () => ({
  useConnectionStore: { getState: jest.fn() },
}))

const getStateMock = (useConnectionStore as unknown as { getState: jest.Mock }).getState

function mockHost(getSessionState: jest.Mock) {
  getStateMock.mockReturnValue({ channels: { claude: { getSessionState } } })
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return { messages: [], isStreaming: false, ...overrides }
}

beforeEach(() => {
  useSessionRuntimeStore.setState({ runtimes: {} })
  getStateMock.mockReset()
})

test('keeps the first user prompt as the row preview', async () => {
  mockHost(jest.fn().mockResolvedValue(snapshot({
    messages: [
      { role: 'user', content: '  fix the login bug  ' },
      { role: 'assistant', content: 'on it' },
      { role: 'user', content: 'also the logout one' },
    ],
  })))

  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(useSessionRuntimeStore.getState().runtimes.s1.preview).toBe('fix the login bug')
})

test('skips a compaction summary, which is not a prompt anyone wrote', async () => {
  mockHost(jest.fn().mockResolvedValue(snapshot({
    messages: [
      { role: 'user', content: 'x'.repeat(15000), isCompactSummary: true },
      { role: 'user', content: 'the real question' },
    ],
  })))

  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(useSessionRuntimeStore.getState().runtimes.s1.preview).toBe('the real question')
})

test('reports agent activity, not process liveness', async () => {
  mockHost(jest.fn().mockResolvedValue(snapshot({ isStreaming: true })))
  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(useSessionRuntimeStore.getState().runtimes.s1.activity).toBe('working')
})

test('a session the host no longer knows is stopped', async () => {
  mockHost(jest.fn().mockResolvedValue(null))
  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(useSessionRuntimeStore.getState().runtimes.s1.activity).toBe('stopped')
})

test('drops rows for sessions that are no longer listed', async () => {
  mockHost(jest.fn().mockResolvedValue(snapshot()))
  await useSessionRuntimeStore.getState().refresh(['s1', 's2'])
  expect(Object.keys(useSessionRuntimeStore.getState().runtimes).sort()).toEqual(['s1', 's2'])

  // s2 was closed: its last known status must not linger on screen.
  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(Object.keys(useSessionRuntimeStore.getState().runtimes)).toEqual(['s1'])
})

test('a failed fetch does not erase what we already knew', async () => {
  mockHost(jest.fn().mockResolvedValue(snapshot({
    isStreaming: true,
    messages: [{ role: 'user', content: 'keep me' }],
  })))
  await useSessionRuntimeStore.getState().refresh(['s1'])

  mockHost(jest.fn().mockRejectedValue(new Error('not connected to remote server')))
  await useSessionRuntimeStore.getState().refresh(['s1'])

  // A dropped request is not evidence the session changed.
  const runtime = useSessionRuntimeStore.getState().runtimes.s1
  expect(runtime.activity).toBe('working')
  expect(runtime.preview).toBe('keep me')
})

test('an empty preview does not overwrite one we already have', async () => {
  mockHost(jest.fn().mockResolvedValue(snapshot({ messages: [{ role: 'user', content: 'original' }] })))
  await useSessionRuntimeStore.getState().refresh(['s1'])

  mockHost(jest.fn().mockResolvedValue(snapshot({ messages: [] })))
  await useSessionRuntimeStore.getState().refresh(['s1'])

  expect(useSessionRuntimeStore.getState().runtimes.s1.preview).toBe('original')
})

test('concurrent refreshes for the same session hit the host once', async () => {
  // Three screens can mount focus effects at once; without in-flight tracking
  // each fires its own snapshot request for the same rows.
  let resolve: (value: unknown) => void = () => {}
  const pending = new Promise(r => { resolve = r })
  const getSessionState = jest.fn().mockReturnValue(pending)
  mockHost(getSessionState)

  const a = useSessionRuntimeStore.getState().refresh(['s1'])
  const b = useSessionRuntimeStore.getState().refresh(['s1'])
  resolve(snapshot())
  await Promise.all([a, b])

  expect(getSessionState).toHaveBeenCalledTimes(1)
})

test('maxAgeMs skips a session fetched moments ago', async () => {
  const getSessionState = jest.fn().mockResolvedValue(snapshot())
  mockHost(getSessionState)

  await useSessionRuntimeStore.getState().refresh(['s1'])
  await useSessionRuntimeStore.getState().refresh(['s1'], { maxAgeMs: 60_000 })
  expect(getSessionState).toHaveBeenCalledTimes(1)

  // …but an explicit refresh always re-asks.
  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(getSessionState).toHaveBeenCalledTimes(2)
})

test('does nothing when there is no connection', async () => {
  getStateMock.mockReturnValue({ channels: null })
  await useSessionRuntimeStore.getState().refresh(['s1'])
  expect(useSessionRuntimeStore.getState().runtimes).toEqual({})
})
