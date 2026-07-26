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
