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

function stream(text: string) {
  useClaudeStore.getState().handleStream(SESSION_ID, { text } as never)
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  useClaudeStore.getState().initSession(SESSION_ID)
})

describe('streamed replies survive every way a turn can end', () => {
  it('does not leave a failed send marked as working or freshly completed', () => {
    const store = useClaudeStore.getState()
    stream('Earlier reply')
    store.handleTurnEnd(SESSION_ID)
    store.handleMessage(SESSION_ID, { id: 'pending', sessionId: SESSION_ID, role: 'user', content: 'Next', timestamp: Date.now(), status: 'sending' })
    expect(useClaudeStore.getState().sessions[SESSION_ID].turnStartedAt).not.toBeNull()
    store.setUserMessageStatus(SESSION_ID, 'pending', 'failed', 'offline')
    expect(useClaudeStore.getState().sessions[SESSION_ID].turnStartedAt).toBeNull()
    expect(useClaudeStore.getState().sessions[SESSION_ID].lastCompletedAt).toBeNull()
  })
  it('records an observed completion but not an error or an empty turn-end replay', () => {
    const store = useClaudeStore.getState()
    store.handleTurnEnd(SESSION_ID)
    expect(useClaudeStore.getState().sessions[SESSION_ID].lastCompletedAt).toBeFalsy()
    stream('Done')
    store.handleTurnEnd(SESSION_ID)
    expect(useClaudeStore.getState().sessions[SESSION_ID].lastCompletedAt).toBeGreaterThan(0)
    stream('Next task')
    store.handleError(SESSION_ID, 'Failed')
    store.handleTurnEnd(SESSION_ID)
    expect(useClaudeStore.getState().sessions[SESSION_ID].lastCompletedAt).toBeFalsy()
  })
  it('keeps the reply when the turn ends without a result frame', () => {
    // The live repro: tool calls rendered, the whole prose reply vanished,
    // because only handleResult ever committed streamingText.
    stream('Here is what I found.')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)

    expect(assistantTexts()).toEqual(['Here is what I found.'])
    expect(useClaudeStore.getState().sessions[SESSION_ID].streamingText).toBe('')
  })

  it('keeps the reply when the turn dies with an error', () => {
    stream('Partial answer before the host died.')
    useClaudeStore.getState().handleError(SESSION_ID, 'LiveQuery is closed')

    expect(assistantTexts()).toEqual(['Partial answer before the host died.'])
    const last = messagesOf()[messagesOf().length - 1] as ClaudeMessage
    expect(last.role).toBe('system')
    expect(last.content).toContain('LiveQuery is closed')
  })

  it('keeps the reply when the next message arrives first', () => {
    stream('Thinking out loud.')
    useClaudeStore.getState().handleMessage(SESSION_ID, {
      id: 'user-1',
      sessionId: SESSION_ID,
      role: 'user',
      content: 'next prompt',
      timestamp: Date.now(),
    } as ClaudeMessage)

    expect(assistantTexts()).toEqual(['Thinking out loud.'])
    expect(messagesOf()).toHaveLength(2)
  })

  it('does not double up when the host re-sends the streamed text as a message', () => {
    stream('The answer is 42.')
    useClaudeStore.getState().handleMessage(SESSION_ID, {
      id: 'assistant-1',
      sessionId: SESSION_ID,
      role: 'assistant',
      content: 'The answer is 42.',
      timestamp: Date.now(),
    } as ClaudeMessage)

    expect(assistantTexts()).toEqual(['The answer is 42.'])
  })

  it('does not double up when a result frame follows the commit', () => {
    stream('Committed once.')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)
    useClaudeStore.getState().handleResult(SESSION_ID, {
      subtype: 'success',
      result: 'Committed once.',
    } as never)

    expect(assistantTexts()).toEqual(['Committed once.'])
  })

  it('keeps a long reply that quotes an earlier short one', () => {
    // An `includes`-based dedupe would swallow the second reply here.
    stream('ok')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)
    stream('ok — and here is the long follow-up explanation.')
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)

    expect(assistantTexts()).toEqual([
      'ok',
      'ok — and here is the long follow-up explanation.',
    ])
  })

  it('commits nothing when no text streamed', () => {
    useClaudeStore.getState().handleTurnEnd(SESSION_ID)
    expect(messagesOf()).toHaveLength(0)
  })
})
