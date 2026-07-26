/**
 * Parsing of the host's `agent:usage` broadcast.
 *
 * The wire shape is the Rust poller's, not ours: utilization is 0-1 and
 * resetsAt is an ISO string with offset. Getting either wrong is invisible —
 * a chip that renders 0% or nothing at all looks the same as "no data yet".
 */

import { useUsageStore } from '../src/stores/usage-store'

beforeEach(() => {
  useUsageStore.setState({ byProvider: {} })
})

const HOST_SNAPSHOT = {
  fiveHour: { utilization: 0.46, resetsAt: '2026-06-12T22:29:59.744481+08:00' },
  sevenDay: { utilization: 0.17, resetsAt: '2026-06-15T10:59:59.744501+08:00' },
  extraUsage: { isEnabled: true, monthlyLimit: 1000, usedCredits: 12.5, currency: 'USD' },
}

describe('applying a host usage snapshot', () => {
  it('keeps utilization on the wire scale', () => {
    useUsageStore.getState().applyHostSnapshot(HOST_SNAPSHOT)

    const snap = useUsageStore.getState().byProvider.claude
    // 0.46, not 46 — the chip multiplies. Storing a pre-scaled number here
    // would render 4600%.
    expect(snap?.fiveHour?.utilization).toBe(0.46)
    expect(snap?.sevenDay?.utilization).toBe(0.17)
  })

  it('keeps a reset timestamp Date can parse', () => {
    useUsageStore.getState().applyHostSnapshot(HOST_SNAPSHOT)

    const resetsAt = useUsageStore.getState().byProvider.claude?.fiveHour?.resetsAt
    expect(Number.isNaN(new Date(resetsAt!).getTime())).toBe(false)
  })

  it('accepts a window that reports usage but no reset time', () => {
    useUsageStore.getState().applyHostSnapshot({ fiveHour: { utilization: 0.8, resetsAt: null } })

    expect(useUsageStore.getState().byProvider.claude?.fiveHour).toEqual({ utilization: 0.8, resetsAt: null })
  })

  it('drops a window the host omitted rather than inventing zero', () => {
    useUsageStore.getState().applyHostSnapshot({ fiveHour: { utilization: 0.5, resetsAt: null } })

    // 0% reads as "plenty left", which is the opposite of "unknown".
    expect(useUsageStore.getState().byProvider.claude?.sevenDay).toBeNull()
  })

  it('clears figures when the host stops reporting the window', () => {
    useUsageStore.getState().applyHostSnapshot(HOST_SNAPSHOT)
    // An account switch to one with no quota data: the old percentages belong
    // to an account that is no longer in use.
    useUsageStore.getState().applyHostSnapshot({ fiveHour: null, sevenDay: null })

    expect(useUsageStore.getState().byProvider.claude?.fiveHour).toBeNull()
    expect(useUsageStore.getState().byProvider.claude?.sevenDay).toBeNull()
  })

  it('ignores a payload that is not an object', () => {
    useUsageStore.getState().applyHostSnapshot(HOST_SNAPSHOT)
    useUsageStore.getState().applyHostSnapshot(null)

    expect(useUsageStore.getState().byProvider.claude?.fiveHour?.utilization).toBe(0.46)
  })
})

describe('telling the two providers apart', () => {
  it('keeps Codex figures from overwriting Claude ones', () => {
    useUsageStore.getState().applyHostSnapshot({ ...HOST_SNAPSHOT, provider: 'claude' })
    // The host runs both pollers on the same topic ~150s apart. Keyed on
    // nothing, whichever landed last would be shown for every session.
    useUsageStore.getState().applyHostSnapshot({
      provider: 'codex',
      fiveHour: { utilization: 0.02, resetsAt: null },
      sevenDay: null,
    })

    expect(useUsageStore.getState().byProvider.claude?.fiveHour?.utilization).toBe(0.46)
    expect(useUsageStore.getState().byProvider.codex?.fiveHour?.utilization).toBe(0.02)
  })

  it('treats a snapshot with no provider as Claude', () => {
    useUsageStore.getState().applyHostSnapshot(HOST_SNAPSHOT)

    expect(useUsageStore.getState().byProvider.claude?.fiveHour?.utilization).toBe(0.46)
  })
})

/**
 * The connect-time pull, which exists because the broadcast is every ~150s:
 * a client that connects a second after a tick would otherwise show blank
 * chips for nearly the whole interval.
 */
describe('priming from the host pull', () => {
  it('takes every provider in one payload', () => {
    useUsageStore.getState().applyHostSnapshotMap({
      claude: { ...HOST_SNAPSHOT, provider: 'claude' },
      codex: { provider: 'codex', fiveHour: { utilization: 0.02, resetsAt: null }, sevenDay: null },
    })

    expect(useUsageStore.getState().byProvider.claude?.fiveHour?.utilization).toBe(0.46)
    expect(useUsageStore.getState().byProvider.codex?.fiveHour?.utilization).toBe(0.02)
  })

  it('falls back to the map key when the snapshot does not name its provider', () => {
    useUsageStore.getState().applyHostSnapshotMap({ codex: HOST_SNAPSHOT })

    // Read off the value alone this would land under 'claude' — the default —
    // and show Codex quota on every Claude session.
    expect(useUsageStore.getState().byProvider.codex?.fiveHour?.utilization).toBe(0.46)
    expect(useUsageStore.getState().byProvider.claude).toBeUndefined()
  })

  it('ignores what a host without the channel returns', () => {
    // Whatever comes back from a host that never implemented it must not
    // clobber figures a broadcast already delivered.
    useUsageStore.getState().applyHostSnapshot(HOST_SNAPSHOT)
    for (const junk of [null, undefined, 'nope', [], 42]) {
      useUsageStore.getState().applyHostSnapshotMap(junk)
    }

    expect(useUsageStore.getState().byProvider.claude?.fiveHour?.utilization).toBe(0.46)
  })

  it('skips a provider whose entry is empty rather than blanking the rest', () => {
    useUsageStore.getState().applyHostSnapshotMap({
      claude: { ...HOST_SNAPSHOT, provider: 'claude' },
      codex: null,
    })

    expect(useUsageStore.getState().byProvider.claude?.fiveHour?.utilization).toBe(0.46)
    expect(useUsageStore.getState().byProvider.codex).toBeUndefined()
  })
})
