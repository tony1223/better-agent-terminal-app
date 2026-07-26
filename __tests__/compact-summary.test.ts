import { isCompactSummaryMessage } from '../src/utils/compact-summary'
import { useClaudeStore } from '../src/stores/claude-store'
import type { ClaudeMessage } from '../src/types'

const SESSION_ID = 'session-1'

const SUMMARY_TEXT = [
  'This session is being continued from a previous conversation that ran out of context.',
  'The summary below covers the earlier portion of the conversation.',
  '',
  'Summary:',
  '1. Primary Request and Intent: ...',
].join('\n')

function userMessage(content: string, extra: Partial<ClaudeMessage> = {}): ClaudeMessage {
  return {
    id: `m-${content.length}`,
    sessionId: SESSION_ID,
    role: 'user',
    content,
    timestamp: 1_700_000_000_000,
    ...extra,
  }
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
})

describe('spotting an auto-compact continuation', () => {
  it('matches the preamble the SDK writes', () => {
    expect(isCompactSummaryMessage('user', SUMMARY_TEXT)).toBe(true)
    // Leading whitespace survives a round trip through the host.
    expect(isCompactSummaryMessage('user', `\n  ${SUMMARY_TEXT}`)).toBe(true)
  })

  it('trusts a host that labels it, whatever the text says', () => {
    expect(isCompactSummaryMessage('user', 'anything at all', true)).toBe(true)
  })

  it('leaves real messages alone', () => {
    expect(isCompactSummaryMessage('user', 'continue from where you left off')).toBe(false)
    // Talking *about* compaction is not being compacted.
    expect(isCompactSummaryMessage('user', `Why did it say "${SUMMARY_TEXT}"?`)).toBe(false)
    // Only user turns carry the summary.
    expect(isCompactSummaryMessage('assistant', SUMMARY_TEXT)).toBe(false)
  })
})

describe('tagging it on the way into the store', () => {
  it('flags a summary that arrives live', () => {
    useClaudeStore.getState().handleMessage(SESSION_ID, userMessage(SUMMARY_TEXT))

    const [msg] = useClaudeStore.getState().sessions[SESSION_ID].messages as ClaudeMessage[]
    expect(msg.isCompactSummary).toBe(true)
  })

  it('flags one replayed from history, and only that one', () => {
    useClaudeStore.getState().handleHistory(SESSION_ID, [
      userMessage('fix the reconnect logic'),
      userMessage(SUMMARY_TEXT),
    ])

    const messages = useClaudeStore.getState().sessions[SESSION_ID].messages as ClaudeMessage[]
    expect(messages.map(m => m.isCompactSummary)).toEqual([undefined, true])
  })
})
