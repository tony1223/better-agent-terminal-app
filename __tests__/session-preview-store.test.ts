/**
 * The session list's preview line.
 *
 * The thing this store must not do is what its predecessor did: pull a whole
 * transcript per row to extract one line, on every focus. So most of these
 * tests are about *not* fetching.
 */

import { useSessionPreviewStore, PREVIEW_REFRESH_MS, QUIET_PREVIEW_REFRESH_MS } from '../src/stores/session-preview-store'
import { latestMessagePreview, sessionPreviewText } from '../src/utils/session-preview'
import { useConnectionStore } from '../src/stores/connection-store'

let mockSessions: Record<string, { lastDataAt?: number | null }> = {}
jest.mock('../src/stores/claude-store', () => ({ useClaudeStore: { getState: () => ({ scopeKey: 'host/profile', sessions: mockSessions }) } }))

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
  getStateMock.mockReturnValue({ status: 'connected', channels: { claude: { loadArchived } } })
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
  useSessionPreviewStore.setState({ previews: {}, timestamps: {}, fetchedAt: {}, observedDataAt: {} })
  mockSessions = {}
  getStateMock.mockReset()
  setLive('s1', 's2', ...Array.from({ length: 20 }, (_, i) => `s${i}`))
})

test('shows the latest user prompt as the row preview', async () => {
  mockHost(jest.fn().mockResolvedValue(archive(
    { role: 'user', content: '  fix the login bug  ' },
    { role: 'assistant', content: 'on it' },
    { role: 'user', content: 'also the logout one' },
  )))

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('also the logout one')
})

test('reads only a bounded tail page, never the transcript', async () => {
  // The whole point of the rewrite. A limit here is the difference between a
  // few KB and every conversation on the host.
  const loadArchived = jest.fn().mockResolvedValue(archive({ role: 'user', content: 'hi' }))
  mockHost(loadArchived)

  await useSessionPreviewStore.getState().load(['s1'])

  const [, offset, limit] = loadArchived.mock.calls[0]
  expect(offset).toBe(0)
  expect(limit).toBeLessThanOrEqual(8)
})

test('skips a compaction summary to find the latest real prompt', async () => {
  mockHost(jest.fn().mockResolvedValue(archive(
    { role: 'user', content: 'This session is being continued from a previous conversation…' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'the real question' },
  )))

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('the real question')
})

test('uses a reply instead of a compaction summary', async () => {
  // Internal compaction text must not displace a readable reply.
  mockHost(jest.fn().mockResolvedValue(archive(
    { role: 'user', content: 'This session is being continued from a previous conversation…' },
    { role: 'assistant', content: 'ok' },
  )))

  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('ok')
})

test('repeated mounts share a fresh cached preview', async () => {
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

describe('latestMessagePreview', () => {
  test('ignores assistant turns and empty content', () => {
    expect(latestMessagePreview([
      { role: 'assistant', content: 'unprompted greeting' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'the actual question' },
    ])?.text).toBe('the actual question')
  })

  test('survives whatever shape the host sends', () => {
    expect(latestMessagePreview([null, undefined, 'a string', 42, {}])).toBeNull()
    expect(latestMessagePreview([])).toBeNull()
  })

  test('truncates, because a row is one line', () => {
    expect(latestMessagePreview([{ role: 'user', content: 'x'.repeat(5000) }])!.text.length)
      .toBeLessThanOrEqual(160)
  })
})

test('refreshes stale previews to the latest assistant reply', async () => {
  const loadArchived = jest.fn()
    .mockResolvedValueOnce(archive({ role: 'user', content: 'old prompt', timestamp: 1 }))
    .mockResolvedValueOnce(archive({ role: 'assistant', content: 'latest reply', timestamp: 2 }))
  mockHost(loadArchived)
  await useSessionPreviewStore.getState().load(['s1'])
  useSessionPreviewStore.setState({ fetchedAt: { s1: Date.now() - PREVIEW_REFRESH_MS } })
  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('latest reply')
  expect(useSessionPreviewStore.getState().timestamps.s1).toBe(2)
})

test('unchanged host output skips frequent reads but retains a periodic fallback', async () => {
  const loadArchived = jest.fn().mockResolvedValue(archive({ role: 'assistant', content: 'unchanged' }))
  mockHost(loadArchived)
  mockSessions.s1 = { lastDataAt: 123 }
  await useSessionPreviewStore.getState().load(['s1'])
  useSessionPreviewStore.setState({ fetchedAt: { s1: Date.now() - PREVIEW_REFRESH_MS } })
  await useSessionPreviewStore.getState().load(['s1'])
  expect(loadArchived).toHaveBeenCalledTimes(1)
  useSessionPreviewStore.setState({ fetchedAt: { s1: Date.now() - QUIET_PREVIEW_REFRESH_MS } })
  await useSessionPreviewStore.getState().load(['s1'])
  expect(loadArchived).toHaveBeenCalledTimes(2)
})

test('output arriving during an archive read still invalidates the quiet cache', async () => {
  mockSessions.s1 = { lastDataAt: 100 }
  const loadArchived = jest.fn().mockImplementationOnce(async () => {
    mockSessions.s1 = { lastDataAt: 200 }
    return archive({ role: 'assistant', content: 'old reply' })
  }).mockResolvedValue(archive({ role: 'assistant', content: 'new reply' }))
  mockHost(loadArchived)
  await useSessionPreviewStore.getState().load(['s1'])
  useSessionPreviewStore.setState({ fetchedAt: { s1: Date.now() - PREVIEW_REFRESH_MS } })
  await useSessionPreviewStore.getState().load(['s1'])
  expect(previews().s1).toBe('new reply')
  expect(loadArchived).toHaveBeenCalledTimes(2)
})

test('skips tool-only tail pages to find the most recent readable text', async () => {
  const loadArchived = jest.fn()
    .mockResolvedValueOnce({ messages: [{ toolName: 'Read', content: 'not a preview' }], hasMore: true })
    .mockResolvedValueOnce(archive({ role: 'user', content: 'working on login' }, { role: 'assistant', content: 'checking auth' }))
  mockHost(loadArchived)
  await useSessionPreviewStore.getState().load(['s1'])
  expect(loadArchived.mock.calls.map(call => call.slice(1))).toEqual([[0, 8], [8, 8]])
  expect(previews().s1).toBe('checking auth')
})

test('caps tool-only scans and caches empty results to avoid repeated downloads', async () => {
  const loadArchived = jest.fn().mockResolvedValue({ messages: [{ toolName: 'Bash' }], hasMore: true })
  mockHost(loadArchived)
  await useSessionPreviewStore.getState().load(['s1'])
  await useSessionPreviewStore.getState().load(['s1'])
  expect(loadArchived).toHaveBeenCalledTimes(3)
  expect(previews().s1).toBeUndefined()
})

test('does not fetch until the selected profile is ready', async () => {
  const loadArchived = jest.fn()
  getStateMock.mockReturnValue({ status: 'connected', client: { supportsProfileContext: true }, profileStatus: 'opening', channels: { claude: { loadArchived } } })
  await useSessionPreviewStore.getState().load(['s1'])
  expect(loadArchived).not.toHaveBeenCalled()
})

test.each(['profile switch', 'reset', 'hidden'])('discards pending reads after %s', async reason => {
  let release!: (value: unknown) => void
  const loadArchived = jest.fn(() => new Promise(resolve => { release = resolve }))
  mockHost(loadArchived)
  let visible = true
  const pending = useSessionPreviewStore.getState().load(['s1'], () => visible)
  if (reason === 'profile switch') mockHost(jest.fn())
  if (reason === 'reset') useSessionPreviewStore.getState().forget('s1')
  if (reason === 'hidden') visible = false
  release(archive({ role: 'user', content: 'stale result' }))
  await pending
  expect(previews().s1).toBeUndefined()
})

test('uses live prompts/replies immediately and newer archives over stale local history', () => {
  const session = { isStreaming: false, streamingText: '', messages: [{ role: 'user', content: 'new prompt', timestamp: 20 }] }
  expect(sessionPreviewText(session, 'old reply', 10)).toBe('new prompt')
  expect(sessionPreviewText(session, 'remote reply', 30)).toBe('remote reply')
  expect(sessionPreviewText({ ...session, isStreaming: true, streamingText: 'now responding' }, 'old reply', 10)).toBe('now responding')
  expect(sessionPreviewText(undefined, 'archive')).toBe('archive')
})

test('ignores malformed content, tools, summaries, thinking-only and subagent messages', () => {
  expect(latestMessagePreview([
    { role: 'user', content: '  fix\n the   login  ', timestamp: 1 },
    { role: 'assistant', content: '' },
    { role: 'system', content: 'internal status' },
    { role: 'assistant', content: 'subagent result', parentToolUseId: 't1' },
    { role: 'user', content: 'summary', isCompactSummary: true },
    { role: 'assistant', content: 42 },
    { role: 'assistant', content: 'tool dump', toolName: 'Read' },
  ])).toEqual({ text: 'fix the login', timestamp: 1 })
})
