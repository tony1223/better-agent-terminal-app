import { useClaudeStore } from '../src/stores/claude-store'
import type { SessionMeta } from '../src/types'

const SESSION_ID = 'session-1'

function usageMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    totalCost: 0.5,
    inputTokens: 100,
    outputTokens: 200,
    durationMs: 1000,
    numTurns: 1,
    contextWindow: 200000,
    ...overrides,
  }
}

beforeEach(() => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
})

describe('host model adoption', () => {
  it('adopts the top-level model when the host reports no meta yet', () => {
    useClaudeStore.getState().handleSessionState(SESSION_ID, {
      messages: [],
      isStreaming: false,
      model: 'opus',
      permissionMode: 'plan',
    })

    const meta = useClaudeStore.getState().sessions[SESSION_ID].meta
    expect(meta?.model).toBe('opus')
    expect(meta?.permissionMode).toBe('plan')
  })

  it('keeps the adopted model when a status meta omits it', () => {
    const store = useClaudeStore.getState()
    store.handleSessionState(SESSION_ID, { model: 'opus', permissionMode: 'plan' })
    // ClaudeScreen applies the snapshot's meta right after the snapshot itself;
    // that meta carries usage counters only and must not wipe the model.
    store.handleStatus(SESSION_ID, usageMeta())

    const meta = useClaudeStore.getState().sessions[SESSION_ID].meta
    expect(meta?.model).toBe('opus')
    expect(meta?.permissionMode).toBe('plan')
    expect(meta?.totalCost).toBe(0.5)
  })

  it('lets a status meta that does carry a model win', () => {
    const store = useClaudeStore.getState()
    store.handleSessionState(SESSION_ID, { model: 'opus' })
    store.handleStatus(SESSION_ID, usageMeta({ model: 'sonnet' }))

    expect(useClaudeStore.getState().sessions[SESSION_ID].meta?.model).toBe('sonnet')
  })

  it('overrides a stale local model with the host value on refresh', () => {
    const store = useClaudeStore.getState()
    store.handleStatus(SESSION_ID, usageMeta({ model: 'sonnet' }))
    store.handleSessionState(SESSION_ID, { meta: usageMeta(), model: 'opus' })

    expect(useClaudeStore.getState().sessions[SESSION_ID].meta?.model).toBe('opus')
  })
})
