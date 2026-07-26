import {
  deriveAgentActivity,
  derivePtyActivity,
  runtimePhaseLabel,
  type LiveSessionActivity,
} from '../src/utils/session-status'
import type { TerminalInstance } from '../src/types'

function live(overrides: Partial<LiveSessionActivity> = {}): LiveSessionActivity {
  return { isStreaming: false, meta: null, ...overrides }
}

describe('deriveAgentActivity', () => {
  test('a session we have heard nothing about is idle, not working', () => {
    // Silence is evidence: a session with a turn in flight emits stream events
    // continuously, so no entry at all means nothing is running. Guessing
    // "working" here would leave every untouched row spinning forever.
    expect(deriveAgentActivity(undefined)).toBe('idle')
  })

  test('streaming is working', () => {
    expect(deriveAgentActivity(live({ isStreaming: true }))).toBe('working')
  })

  test('a live session with nothing in flight is idle', () => {
    expect(deriveAgentActivity(live())).toBe('idle')
  })

  test('pre-stream runtime phases count as working', () => {
    // The host clears runtimeStatus once the model starts responding and
    // isStreaming takes over, so these are the window neither flag alone covers.
    for (const runtimeStatus of ['starting', 'queued', 'waiting_for_api', 'compacting']) {
      expect(deriveAgentActivity(live({ meta: { runtimeStatus } }))).toBe('working')
    }
  })

  test('a cleared runtime status is not working', () => {
    expect(deriveAgentActivity(live({ meta: { runtimeStatus: null } }))).toBe('idle')
  })

  test('an unrecognised runtime status does not imply work', () => {
    expect(deriveAgentActivity(live({ meta: { runtimeStatus: 'wat' } }))).toBe('idle')
  })
})

describe('runtimePhaseLabel', () => {
  test('renders the phase readably', () => {
    expect(runtimePhaseLabel(live({ meta: { runtimeStatus: 'waiting_for_api' } })))
      .toBe('waiting for api')
  })

  test('is null while merely streaming, where the phase adds nothing', () => {
    expect(runtimePhaseLabel(live({ isStreaming: true }))).toBeNull()
    expect(runtimePhaseLabel(undefined)).toBeNull()
  })
})

describe('derivePtyActivity', () => {
  const base = { id: 't1', workspaceId: 'w1', type: 'terminal', title: 'sh', cwd: '/', scrollbackBuffer: [] }

  test('reports the process, which for a plain shell is the whole story', () => {
    expect(derivePtyActivity({ ...base, pid: 42 } as TerminalInstance)).toBe('idle')
    expect(derivePtyActivity(base as TerminalInstance)).toBe('stopped')
  })
})
