/**
 * A host snapshot must never silently shorten the transcript on screen.
 *
 * getSessionState returns whatever the host is still holding in memory. For a
 * long session that is the tail — the rest has been archived — and ClaudeScreen
 * re-applies a snapshot on every focus and reconnect. Adopting it wholesale
 * blanked the scrollback above the newest few tool calls.
 */

import { useClaudeStore } from '../src/stores/claude-store'
import type { ClaudeMessage } from '../src/types'

const SESSION_ID = 'session-truncation'

function messages(count: number, prefix = 'm'): ClaudeMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    sessionId: SESSION_ID,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${prefix} message ${i}`,
    timestamp: i,
  })) as ClaudeMessage[]
}

function currentMessages() {
  return useClaudeStore.getState().sessions[SESSION_ID]?.messages ?? []
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
})

test('a short live tail does not replace a long transcript', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(200))

  // The host only still holds the last few; the rest is archived.
  store.handleSessionState(SESSION_ID, { messages: messages(3, 'tail'), isStreaming: true })

  expect(currentMessages()).toHaveLength(200)
})

test('an equal or longer snapshot is still authoritative', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(3))
  store.handleSessionState(SESSION_ID, { messages: messages(10, 'host'), isStreaming: false })

  const result = currentMessages()
  expect(result).toHaveLength(10)
  expect((result[0] as ClaudeMessage).content).toBe('host message 0')
})

test('a compaction genuinely shortens the conversation and is honoured', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(200))

  // The SDK feeds its summary back as the next user turn; that really is the
  // conversation now, so it must win despite being shorter.
  store.handleSessionState(SESSION_ID, {
    messages: [
      {
        id: 'summary',
        sessionId: SESSION_ID,
        role: 'user',
        content: 'This session is being continued from a previous conversation…',
        timestamp: 0,
      },
      { id: 'after', sessionId: SESSION_ID, role: 'assistant', content: 'carrying on', timestamp: 1 },
    ] as ClaudeMessage[],
    isStreaming: false,
  })

  expect(currentMessages()).toHaveLength(2)
})

test('the host flag alone marks a compaction, without the preamble text', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(50))
  store.handleSessionState(SESSION_ID, {
    messages: [
      { id: 's', sessionId: SESSION_ID, role: 'user', content: 'condensed', isCompactSummary: true, timestamp: 0 },
    ] as ClaudeMessage[],
    isStreaming: false,
  })

  expect(currentMessages()).toHaveLength(1)
})

test('an empty session adopts whatever the host has', () => {
  useClaudeStore.getState().handleSessionState(SESSION_ID, { messages: messages(5), isStreaming: false })
  expect(currentMessages()).toHaveLength(5)
})

test('/new clears the way for a shorter conversation', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(200))
  store.handleSessionReset(SESSION_ID)
  store.handleSessionState(SESSION_ID, { messages: messages(1, 'fresh'), isStreaming: false })

  expect(currentMessages()).toHaveLength(1)
})

test('a snapshot with no messages field leaves the transcript alone', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(20))
  store.handleSessionState(SESSION_ID, { isStreaming: true, model: 'opus' })

  expect(currentMessages()).toHaveLength(20)
  expect(useClaudeStore.getState().sessions[SESSION_ID].meta?.model).toBe('opus')
})

test('an empty snapshot does not wipe a live transcript', () => {
  const store = useClaudeStore.getState()
  store.handleHistory(SESSION_ID, messages(20))
  store.handleSessionState(SESSION_ID, { messages: [], isStreaming: false })

  expect(currentMessages()).toHaveLength(20)
})

/**
 * Splicing the host's live window in by id.
 *
 * `appendSessionMessage` stores the very object that went out over
 * `claude:message` (node-sidecar/src/handlers/claude-send.mjs), and
 * `getSessionState` hands that array back verbatim — so the snapshot's ids are
 * the same ids the live events carried. That is what makes a gap repairable
 * without pulling the whole transcript: the snapshot is contiguous, so
 * everything from the first shared id onward can simply be swapped for it.
 */
describe('splicing the host window into a holed transcript', () => {
  function holed() {
    // What a client that missed the middle holds: an old prefix with the newest
    // turns appended directly onto it. Length alone cannot spot this — it looks
    // exactly like a healthy list that outruns the host's window.
    return [...messages(2, 'a'), ...messages(2, 'd')]
  }

  test('the missing middle comes back', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, holed())

    // The host still holds a1 onward, contiguously — including the b/c turns
    // that never reached us.
    const verdict = store.handleSessionState(SESSION_ID, {
      messages: [messages(2, 'a')[1], ...messages(2, 'b'), ...messages(2, 'c'), ...messages(2, 'd')],
      isStreaming: false,
    })

    expect(verdict).toBe('stitched')
    expect(currentMessages().map(m => m.id)).toEqual(['a0', 'a1', 'b0', 'b1', 'c0', 'c1', 'd0', 'd1'])
  })

  test('a longer snapshot does not cost us what came before the host window', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, [...messages(2, 'old'), ...messages(1, 'd')])

    // The snapshot outnumbers the local list, so the length rule would adopt it
    // wholesale — quietly dropping the 'old' pair, which the host has already
    // aged out of its window and cannot send again. The anchor keeps them.
    store.handleSessionState(SESSION_ID, {
      messages: [...messages(1, 'd'), ...messages(2, 'e')],
      isStreaming: false,
    })

    expect(currentMessages().map(m => m.id)).toEqual(['old0', 'old1', 'd0', 'e0', 'e1'])
  })

  test('a snapshot already inside the local list changes nothing', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, messages(20))
    const verdict = store.handleSessionState(SESSION_ID, { messages: messages(20).slice(-3), isStreaming: false })

    expect(verdict).toBe('stitched')
    expect(currentMessages().map(m => m.id)).toEqual(messages(20).map(m => m.id))
  })

  test('no shared id leaves the transcript alone and says so', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, messages(200))

    // The host churned past everything we hold: nothing to anchor the window
    // to, so the caller has to decide (ClaudeScreen escalates to a full pull
    // only when this follows a reconnect).
    const verdict = store.handleSessionState(SESSION_ID, { messages: messages(3, 'unrelated'), isStreaming: false })

    expect(verdict).toBe('kept-local')
    expect(currentMessages()).toHaveLength(200)
  })

  test('a tool call is spliced back like any other item', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, [...messages(3, 'a'), ...messages(1, 'd')])

    // The host buffers tool calls through the same appendSessionMessage, so a
    // gap full of tool activity has to come back too. The snapshot is shorter
    // than the local list here, so the length rule would keep the hole.
    store.handleSessionState(SESSION_ID, {
      messages: [
        messages(3, 'a')[2],
        { id: 'tool-1', sessionId: SESSION_ID, toolName: 'Bash', input: {}, status: 'completed', timestamp: 5 },
        messages(1, 'd')[0],
      ] as any,
      isStreaming: false,
    })

    expect(currentMessages().map(m => m.id)).toEqual(['a0', 'a1', 'a2', 'tool-1', 'd0'])
  })
})

/**
 * Repairing a disconnect, which is the other half of the rule above.
 *
 * Events sent while the socket was down are never replayed, so the local list
 * ends up as an old prefix with newer messages appended straight onto it — a
 * hole in the middle. The snapshot path cannot fix that (it is capped at the
 * host's 300 in-memory messages and refuses to shorten), so ClaudeScreen asks
 * the host to re-serve the whole transcript from disk over `claude:history`.
 */
describe('re-serving the transcript after a reconnect', () => {
  test('a full transcript replaces a locally-holed one', () => {
    const store = useClaudeStore.getState()
    // What a client that missed the middle is left holding: an early prefix
    // with the newest turns appended directly onto it.
    store.handleHistory(SESSION_ID, [...messages(3, 'early'), ...messages(2, 'late')])

    store.handleHistory(SESSION_ID, messages(400, 'full'))

    const result = currentMessages()
    expect(result).toHaveLength(400)
    expect((result[0] as ClaudeMessage).content).toBe('full message 0')
  })

  test('a transcript the host could not read does not wipe the conversation', () => {
    const store = useClaudeStore.getState()
    store.handleHistory(SESSION_ID, messages(200))

    // claude-history.mjs answers an unreadable/missing .jsonl with `items: []`
    // rather than an error. Before the repair path existed this only ever
    // arrived against a blank screen; now it can land on a full one.
    store.handleHistory(SESSION_ID, [])

    expect(currentMessages()).toHaveLength(200)
  })

  test('an empty transcript is still accepted when there is nothing to lose', () => {
    const store = useClaudeStore.getState()
    store.initSession(SESSION_ID)
    store.handleHistory(SESSION_ID, [])

    expect(currentMessages()).toHaveLength(0)
  })
})
