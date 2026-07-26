/**
 * The session list's preview line.
 *
 * The thing this store must not do is what its predecessor did: pull a whole
 * transcript per row to extract one line, on every focus. So most of these
 * tests are about *not* fetching.
 */

import { useSessionPreviewStore, firstUserPrompt } from '../src/stores/session-preview-store'
import { useConnectionStore } from '../src/stores/connection-store'

jest.mock('../src/stores/connection-store', () => ({
  useConnectionStore: { getState: jest.fn() },
}))

// Which sessions exist is the workspace store's answer, not the caller's — a
// screen only ever passes the slice it can see.
let mockLiveTerminals: { id: string }[] = []
jest.mock('../src/stores/workspace-store', () => ({
  useWorkspaceStore: { getState: () => ({ terminals: mockLiveTerminals }) },
}))

const getStateMock = (useConnectionStore as unknown as { getState: jest.Mock }).getState

function mockHost(loadArchived: jest.Mock) {
  getStateMock.mockReturnValue({ channels: { claude: { loadArchived } } })
}

/** The sessions the host currently has open. */
function setLive(...ids: string[]) {
  mockLiveTerminals = ids.map(id => ({ id }))
}

function archive(...messages: Record<string, unknown>[]) {
  return { messages, total: messages.length, hasMore: false }
}

const previews = () => useSessionPreviewStore.getState().previews

beforeEach(() => {
  useSessionPreviewStore.setState({ previews: {} })
  getStateMock.mockReset()
  setLive('s1', 's2', ...Array.from({ length: 20 }, (_, i) => `s${i}`))
})

test('keeps the first user prompt as the row preview', async () => {
  mockHost(jest.fn().mockResolvedValue(archive(
    { role: 'user', content: '  fix the login bug  ' },
    { role: 'assistant', content: 'on it' },
    { role: 'user', content: 'also the logout one' },
  )))

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('fix the login bug')
})

test('reads only the head of the archive, never the transcript', async () => {
  // The whole point of the rewrite. A limit here is the difference between a
  // few KB and every conversation on the host.
  const loadArchived = jest.fn().mockResolvedValue(archive({ role: 'user', content: 'hi' }))
  mockHost(loadArchived)

  await useSessionPreviewStore.getState().load(['s1'])

  const [, offset, limit] = loadArchived.mock.calls[0]
  expect(offset).toBe(0)
  expect(limit).toBeLessThanOrEqual(8)
})

test('skips a compaction summary to find the real opening prompt', async () => {
  mockHost(jest.fn().mockResolvedValue(archive(
    { role: 'user', content: 'This session is being continued from a previous conversation…' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'the real question' },
  )))

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('the real question')
})

test('falls back to the summary when the window holds nothing else', async () => {
  // Better a truncated summary than a blank row.
  mockHost(jest.fn().mockResolvedValue(archive(
    { role: 'user', content: 'This session is being continued from a previous conversation…' },
    { role: 'assistant', content: 'ok' },
  )))

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toContain('This session is being continued')
})

test('a known preview is never fetched again', async () => {
  const loadArchived = jest.fn().mockResolvedValue(archive({ role: 'user', content: 'once' }))
  mockHost(loadArchived)

  await useSessionPreviewStore.getState().load(['s1'])
  await useSessionPreviewStore.getState().load(['s1'])
  await useSessionPreviewStore.getState().load(['s1'])

  expect(loadArchived).toHaveBeenCalledTimes(1)
})

test('concurrent loads for the same id share one request', async () => {
  const loadArchived = jest.fn(() => new Promise(resolve => {
    setTimeout(() => resolve(archive({ role: 'user', content: 'shared' })), 5)
  }))
  mockHost(loadArchived as unknown as jest.Mock)

  await Promise.all([
    useSessionPreviewStore.getState().load(['s1']),
    useSessionPreviewStore.getState().load(['s1']),
  ])

  expect(loadArchived).toHaveBeenCalledTimes(1)
})

test('a failed read is not cached, so the next visit retries', async () => {
  const loadArchived = jest.fn()
    .mockRejectedValueOnce(new Error('socket closed'))
    .mockResolvedValueOnce(archive({ role: 'user', content: 'second time lucky' }))
  mockHost(loadArchived)

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBeUndefined()

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('second time lucky')
})

test('closed sessions lose their line', async () => {
  setLive('s1', 's2')
  mockHost(jest.fn().mockResolvedValue(archive({ role: 'user', content: 'hello' })))

  await useSessionPreviewStore.getState().load(['s1', 's2'])
  expect(Object.keys(previews()).sort()).toEqual(['s1', 's2'])

  setLive('s1')
  await useSessionPreviewStore.getState().load(['s1'])
  expect(Object.keys(previews())).toEqual(['s1'])

  setLive()
  await useSessionPreviewStore.getState().load([])
  expect(previews()).toEqual({})
})

test('a screen showing one workspace does not evict another workspace', async () => {
  // The detail pane only ever passes its own sessions. Pruning against that
  // would drop every other row and send the two screens into a refetch loop.
  setLive('s1', 's2')
  const loadArchived = jest.fn().mockResolvedValue(archive({ role: 'user', content: 'hello' }))
  mockHost(loadArchived)

  await useSessionPreviewStore.getState().load(['s1', 's2'])
  await useSessionPreviewStore.getState().load(['s1'])

  expect(Object.keys(previews()).sort()).toEqual(['s1', 's2'])
  expect(loadArchived).toHaveBeenCalledTimes(2)
})

test('a session closed mid-flight does not come back', async () => {
  setLive('s1')
  let release: (v: unknown) => void = () => {}
  mockHost(jest.fn(() => new Promise(resolve => { release = resolve })) as unknown as jest.Mock)

  const pending = useSessionPreviewStore.getState().load(['s1'])
  setLive()
  release(archive({ role: 'user', content: 'ghost' }))
  await pending

  expect(previews().s1).toBeUndefined()
})

test('does nothing at all while disconnected', async () => {
  getStateMock.mockReturnValue({ channels: null })
  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews()).toEqual({})
})

test('fetches are pooled rather than fired all at once', async () => {
  let live = 0
  let peak = 0
  mockHost(jest.fn(() => {
    live++
    peak = Math.max(peak, live)
    return new Promise(resolve => setTimeout(() => {
      live--
      resolve(archive({ role: 'user', content: 'x' }))
    }, 2))
  }) as unknown as jest.Mock)

  await useSessionPreviewStore.getState().load(Array.from({ length: 20 }, (_, i) => `s${i}`))

  // Bounded, but genuinely concurrent — a serial implementation would also
  // satisfy the upper bound alone and would be far too slow over a phone link.
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(4)
  expect(Object.keys(previews())).toHaveLength(20)
})

test('forget drops a preview so a reset session can be re-read', async () => {
  const loadArchived = jest.fn()
    .mockResolvedValueOnce(archive({ role: 'user', content: 'before /new' }))
    .mockResolvedValueOnce(archive({ role: 'user', content: 'after /new' }))
  mockHost(loadArchived)

  await useSessionPreviewStore.getState().load(['s1'])
  useSessionPreviewStore.getState().forget('s1')
  await useSessionPreviewStore.getState().load(['s1'])

  expect(previews().s1).toBe('after /new')
})

describe('firstUserPrompt', () => {
  test('ignores assistant turns and empty content', () => {
    expect(firstUserPrompt([
      { role: 'assistant', content: 'unprompted greeting' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'the actual question' },
    ])).toBe('the actual question')
  })

  test('survives whatever shape the host sends', () => {
    expect(firstUserPrompt([null, undefined, 'a string', 42, {}])).toBe('')
    expect(firstUserPrompt([])).toBe('')
  })

  test('truncates, because a row is one line', () => {
    expect(firstUserPrompt([{ role: 'user', content: 'x'.repeat(5000) }]).length)
      .toBeLessThanOrEqual(160)
  })
})
