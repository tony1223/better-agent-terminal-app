/**
 * A message that never reached the host must not be deleted by the host.
 *
 * Every merge path rebuilds the transcript out of the host's copy, and a send
 * that failed is by definition absent from that copy — so the merge drops it.
 * The timing is the problem: sends fail because the socket went down, and the
 * reconnect that follows resyncs the transcript within the same second. The
 * composer was cleared when the send started, so once the bubble goes the text
 * exists nowhere at all and there is nothing left to retry.
 *
 * The second half covers the other way a send becomes unretryable: the host
 * answering "session has no cwd" because it lost the session. Re-sending into
 * that cannot work, so the retry link is dead until something rebuilds the
 * session first.
 */

import { useClaudeStore, registerSessionRecovery } from '../src/stores/claude-store'
import { useConnectionStore } from '../src/stores/connection-store'
import type { ClaudeMessage } from '../src/types'

jest.mock('../src/stores/connection-store', () => ({
  useConnectionStore: { getState: jest.fn() },
}))

const getStateMock = (useConnectionStore as unknown as { getState: jest.Mock }).getState

const SESSION_ID = 'session-pending'
const NO_CWD = 'claude.sendMessage(2c4a057e): session has no cwd; startSession must be called with options.cwd'

function hostMessages(count: number, prefix = 'h'): ClaudeMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    sessionId: SESSION_ID,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${prefix} message ${i}`,
    timestamp: i,
  })) as ClaudeMessage[]
}

/** What handleSend leaves on screen the moment a send fails. */
function failedSend(content = 'the message that never made it', id = 'user-local-1'): ClaudeMessage {
  return {
    id,
    sessionId: SESSION_ID,
    role: 'user',
    content,
    timestamp: 1_000,
    status: 'failed',
    failureReason: 'Not connected',
    sendPayload: { messageText: content },
  } as ClaudeMessage
}

function currentIds() {
  return (useClaudeStore.getState().sessions[SESSION_ID]?.messages ?? []).map(m => m.id)
}

function seedWithFailedSend(local: ClaudeMessage[] = hostMessages(3)) {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, local)
  store.handleMessage(SESSION_ID, failedSend())
  useClaudeStore.getState().setUserMessageStatus(SESSION_ID, 'user-local-1', 'failed', 'Not connected')
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  getStateMock.mockReturnValue({ channels: null })
})

describe('un-acked sends across a transcript merge', () => {
  test('a failed send survives the snapshot pulled on reconnect', () => {
    seedWithFailedSend()

    // The resync that follows every reconnect. The host's window is longer, so
    // it is adopted wholesale — and the failed bubble is not in it.
    useClaudeStore.getState().handleSessionState(SESSION_ID, {
      messages: hostMessages(6),
      isStreaming: false,
    })

    expect(currentIds()).toContain('user-local-1')
  })

  test('a failed send survives the host re-serving the whole transcript', () => {
    seedWithFailedSend()

    // The escalation path: client-resume re-reads the .jsonl and pushes it over
    // claude:history, which replaces the list outright.
    useClaudeStore.getState().handleHistory(SESSION_ID, hostMessages(50, 'full'))

    expect(currentIds()).toContain('user-local-1')
    expect(currentIds()).toHaveLength(51)
  })

  test('a failed send survives a spliced host window', () => {
    seedWithFailedSend()

    // The splice keeps the local prefix and swaps everything from the first
    // shared id onward — which is where the failed bubble sits.
    const verdict = useClaudeStore.getState().handleSessionState(SESSION_ID, {
      messages: [...hostMessages(3).slice(1), ...hostMessages(2, 'new')],
      isStreaming: false,
    })

    expect(verdict).toBe('stitched')
    expect(currentIds()).toContain('user-local-1')
  })

  test('it is re-attached last, where the user left it', () => {
    seedWithFailedSend()
    useClaudeStore.getState().handleHistory(SESSION_ID, hostMessages(4, 'full'))

    expect(currentIds()[currentIds().length - 1]).toBe('user-local-1')
  })

  test('a send the host did receive is not doubled', () => {
    seedWithFailedSend()

    // The ack was lost, not the message: the host has it after all, and its
    // echo arrives in the merge. Carrying ours too would show the turn twice.
    useClaudeStore.getState().handleHistory(SESSION_ID, [
      ...hostMessages(3),
      {
        id: 'host-echo',
        sessionId: SESSION_ID,
        role: 'user',
        content: 'the message that never made it',
        timestamp: 1_200,
      } as ClaudeMessage,
    ])

    expect(currentIds()).not.toContain('user-local-1')
    expect(currentIds()).toContain('host-echo')
  })

  test('an acked message is left to the host', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, hostMessages(3))
    store.handleMessage(SESSION_ID, { ...failedSend('already delivered'), status: 'sent' } as ClaudeMessage)

    // 'sent' means the host owns it now. Re-attaching it would resurrect a
    // message a /new or a rewind had legitimately removed.
    store.handleHistory(SESSION_ID, hostMessages(3, 'fresh'))

    expect(currentIds()).toEqual(['fresh0', 'fresh1', 'fresh2'])
  })
})

describe('sending into a host session that is gone', () => {
  function mockSend(sendMessage: jest.Mock) {
    getStateMock.mockReturnValue({ status: 'connected', channels: { claude: { sendMessage } } })
  }

  function pendingMessage() {
    useClaudeStore.getState().handleMessage(SESSION_ID, {
      ...failedSend('hello'),
      status: 'sending',
    } as ClaudeMessage)
  }

  function statusOf(id: string) {
    const message = useClaudeStore.getState().sessions[SESSION_ID]?.messages.find(m => m.id === id)
    return message && !('toolName' in message) ? message.status : undefined
  }

  test('the session is rebuilt and the message re-sent, once', async () => {
    const sendMessage = jest.fn()
      .mockRejectedValueOnce(new Error(NO_CWD))
      .mockResolvedValueOnce({ ok: true })
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    expect(recover).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(statusOf('user-local-1')).toBe('sent')
  })

  test('a rebuild that does not take gives up instead of looping', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error(NO_CWD))
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    // Two sends and one repair: retrying a repair that is not landing would
    // only bury the reason under identical attempts.
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(statusOf('user-local-1')).toBe('failed')
  })

  test('a no-cwd error returned as a result also rebuilds the session', async () => {
    const sendMessage = jest.fn()
      .mockResolvedValueOnce({ ok: false, error: NO_CWD })
      .mockResolvedValueOnce({ ok: true })
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    expect(recover).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(statusOf('user-local-1')).toBe('sent')
  })

  test('a rejected result after repair leaves the message retryable', async () => {
    const sendMessage = jest.fn().mockResolvedValue({ ok: false, error: NO_CWD })
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    expect(recover).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(statusOf('user-local-1')).toBe('failed')
  })

  test.each([
    { ok: false, error: 'session stopped' },
    { ok: false, cancelled: true },
    { ok: false },
  ])('does not acknowledge a rejected send: %j', async result => {
    const sendMessage = jest.fn().mockResolvedValue(result)
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    expect(recover).not.toHaveBeenCalled()
    expect(statusOf('user-local-1')).toBe('failed')
  })

  test('an ordinary send failure is not treated as a lost session', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error('Remote invoke timeout: agent:send-message'))
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    // A timeout means the session is fine and the link is not; tearing the
    // session down over it would abort a turn that is very likely running.
    expect(recover).not.toHaveBeenCalled()
    expect(statusOf('user-local-1')).toBe('failed')
  })

  test('the retry link runs the same repair', async () => {
    const sendMessage = jest.fn()
      .mockRejectedValueOnce(new Error(NO_CWD))
      .mockResolvedValueOnce({ ok: true })
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)
    useClaudeStore.getState().handleMessage(SESSION_ID, failedSend('hello'))

    useClaudeStore.getState().retryUserMessage(SESSION_ID, 'user-local-1')
    await new Promise<void>(resolve => setImmediate(() => resolve()))

    expect(recover).toHaveBeenCalledTimes(1)
    expect(statusOf('user-local-1')).toBe('sent')
  })

  test('unregistering leaves the failure to speak for itself', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error(NO_CWD))
    mockSend(sendMessage)
    const recover = jest.fn().mockResolvedValue(undefined)
    registerSessionRecovery(SESSION_ID, recover)()
    pendingMessage()

    await useClaudeStore.getState()
      .deliverUserMessage(SESSION_ID, 'user-local-1', { messageText: 'hello' })

    expect(recover).not.toHaveBeenCalled()
    expect(statusOf('user-local-1')).toBe('failed')
  })
})
