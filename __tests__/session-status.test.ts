import {
  deriveAgentActivity,
  derivePtyActivity,
  runtimePhaseLabel,
} from '../src/utils/session-status'
import type { SessionStateSnapshot, TerminalInstance } from '../src/types'

function snapshot(overrides: Partial<SessionStateSnapshot> = {}): SessionStateSnapshot {
  return { messages: [], isStreaming: false, ...overrides }
}

describe('deriveAgentActivity', () => {
  test('never-polled and no-such-session are different answers', () => {
    // 'unknown' must not collapse into 'stopped', or a row claims a session
    // finished during the gap before its first fetch resolves.
    expect(deriveAgentActivity(undefined)).toBe('unknown')
    expect(deriveAgentActivity(null)).toBe('stopped')
  })

  test('streaming is working', () => {
    expect(deriveAgentActivity(snapshot({ isStreaming: true }))).toBe('working')
  })

  test('a live session with nothing in flight is idle', () => {
    expect(deriveAgentActivity(snapshot())).toBe('idle')
  })

  test('pre-stream runtime phases count as working', () => {
    // The host clears runtimeStatus once the model starts responding and
    // isStreaming takes over, so these are the window neither flag alone covers.
    for (const runtimeStatus of ['starting', 'queued', 'waiting_for_api', 'compacting']) {
      expect(deriveAgentActivity(snapshot({ meta: { runtimeStatus } as never }))).toBe('working')
    }
  })

  test('a cleared runtime status is not working', () => {
    expect(deriveAgentActivity(snapshot({ meta: { runtimeStatus: null } as never }))).toBe('idle')
  })

  test('an unrecognised runtime status does not imply work', () => {
    expect(deriveAgentActivity(snapshot({ meta: { runtimeStatus: 'wat' } as never }))).toBe('idle')
  })
})

describe('runtimePhaseLabel', () => {
  test('renders the phase readably', () => {
    expect(runtimePhaseLabel(snapshot({ meta: { runtimeStatus: 'waiting_for_api' } as never })))
      .toBe('waiting for api')
  })

  test('is null while merely streaming, where the phase adds nothing', () => {
    expect(runtimePhaseLabel(snapshot({ isStreaming: true }))).toBeNull()
    expect(runtimePhaseLabel(null)).toBeNull()
  })
})

describe('derivePtyActivity', () => {
  const base = { id: 't1', workspaceId: 'w1', type: 'terminal', title: 'sh', cwd: '/', scrollbackBuffer: [] }

  test('reports the process, which for a plain shell is the whole story', () => {
    expect(derivePtyActivity({ ...base, pid: 42 } as TerminalInstance)).toBe('idle')
    expect(derivePtyActivity(base as TerminalInstance)).toBe('stopped')
  })
})
