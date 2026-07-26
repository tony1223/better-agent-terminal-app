import { useClaudeStore } from '../src/stores/claude-store'
import type { ClaudeMessage } from '../src/types'

const SESSION_ID = 'session-1'

function messagesOf() {
  return useClaudeStore.getState().sessions[SESSION_ID].messages
}

function assistantTexts() {
  return messagesOf().flatMap(m =>
    !('toolName' in m) && m.role === 'assistant' ? [m.content] : [],
  )
}

function stream(text: string, parentToolUseId?: string) {
  useClaudeStore.getState().handleStream(SESSION_ID, { text, parentToolUseId } as never)
}

function hostMessage(msg: Partial<ClaudeMessage> & { content: string }) {
  useClaudeStore.getState().handleMessage(SESSION_ID, {
    id: `assistant-${msg.content.length}`,
    sessionId: SESSION_ID,
    role: 'assistant',
    timestamp: Date.now(),
    ...msg,
  } as ClaudeMessage)
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  useClaudeStore.getState().initSession(SESSION_ID)
})

describe('a reply is never shown twice', () => {
  it('replaces our committed copy when the host echoes it after a reconnect', () => {
    // The live repro: the socket dropped mid-turn, turn-end committed the
    // streamed text, and the host's message arrived after we reconnected.
    stream('Here is the full answer.')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)
    hostMessage({ id: 'assistant-host', content: 'Here is the full answer.' })

    expect(assistantTexts()).toEqual(['Here is the full answer.'])
    expect(messagesOf()[0].id).toBe('assistant-host')
  })

  it('matches even though the host scrubbed a notification out of the reply', () => {
    stream('Kicked it off.\n<task-notification>done</task-notification>\nAll green.')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)
    // What the sidecar actually echoes: same prose, notification removed.
    hostMessage({ id: 'assistant-host', content: 'Kicked it off.\n\nAll green.' })

    expect(assistantTexts()).toHaveLength(1)
    expect(assistantTexts()[0]).not.toContain('task-notification')
  })

  it('leaves an earlier reply alone when a later one quotes it', () => {
    stream('ok')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)
    useClaudeStore.getState().handleMessage(SESSION_ID, {
      id: 'user-1',
      sessionId: SESSION_ID,
      role: 'user',
      content: 'go on',
      timestamp: Date.now(),
    } as ClaudeMessage)
    hostMessage({ id: 'assistant-2', content: 'ok — and here is the long follow-up.' })

    expect(assistantTexts()).toEqual(['ok', 'ok — and here is the long follow-up.'])
  })

  it('still appends a reply that was never streamed', () => {
    hostMessage({ id: 'assistant-1', content: 'Straight to the point.' })
    expect(assistantTexts()).toEqual(['Straight to the point.'])
  })
})

describe('subagent chatter stays out of the main stream', () => {
  it('does not merge subagent deltas into the main reply', () => {
    stream('Let me look. ')
    stream('searching src/... ', 'toolu_task_1')
    stream('reading files... ', 'toolu_task_2')
    stream('Found it in the store.')

    expect(useClaudeStore.getState().sessions[SESSION_ID].streamingText)
      .toBe('Let me look. Found it in the store.')
  })

  it('keeps the interleaved case from rendering the reply twice', () => {
    // Before the fix the buffer read "Let me look. searching... Found it",
    // which is not a substring of the host's message either way round, so
    // both copies landed in the list.
    stream('Let me look. ')
    stream('searching src/...', 'toolu_task_1')
    stream('Found it in the store.')
    hostMessage({ id: 'assistant-host', content: 'Let me look. Found it in the store.' })

    expect(assistantTexts()).toEqual(['Let me look. Found it in the store.'])
  })

  it('appends a subagent reply without disturbing the main agent mid-sentence', () => {
    stream('Main agent still typing')
    hostMessage({ id: 'sub-1', content: 'subagent report', parentToolUseId: 'toolu_task_1' } as never)

    const session = useClaudeStore.getState().sessions[SESSION_ID]
    expect(session.streamingText).toBe('Main agent still typing')
    expect(session.isStreaming).toBe(true)
    expect(assistantTexts()).toEqual(['subagent report'])
  })
})
