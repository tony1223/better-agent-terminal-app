import { create } from 'zustand'

import { dlog } from '@/utils/debug-log'

export interface UsageWindow {
  /** 0-1, as the host sends it. The UI is what turns it into a percentage. */
  utilization: number | null
  /** ISO 8601 with offset, or null when the endpoint omitted it. */
  resetsAt: string | null
}

export interface UsageSnapshot {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  extraUsage: {
    isEnabled: boolean
    monthlyLimit: number | null
    usedCredits: number | null
    currency: string | null
  } | null
  /** Local clock, for showing how stale the figures are. */
  receivedAt: number
}

/** The host polls Claude and Codex separately and broadcasts both. */
export type UsageProvider = 'claude' | 'codex'

interface UsageState {
  byProvider: Partial<Record<UsageProvider, UsageSnapshot>>
  applyHostSnapshot: (payload: unknown) => void
  applyHostSnapshotMap: (payload: unknown) => void
  clear: () => void
}

function asWindow(value: unknown): UsageWindow | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const utilization = typeof record.utilization === 'number' && Number.isFinite(record.utilization)
    ? record.utilization
    : null
  const resetsAt = typeof record.resetsAt === 'string' ? record.resetsAt : null
  if (utilization == null && resetsAt == null) return null
  return { utilization, resetsAt }
}

/**
 * Host-wide quota, not session-scoped: the Rust host runs one poller per
 * machine and broadcasts `agent:usage` every ~150s. The last snapshot is kept
 * for the life of the process rather than being dropped when a screen
 * unmounts, because the next one may be two and a half minutes away.
 *
 * Two ways in, same shape underneath: the broadcast delivers one provider's
 * snapshot, and the connect-time pull delivers a map of every provider the
 * host has polled so far. Filling in from the pull is what stops a phone that
 * connects between ticks from showing nothing at all.
 */
export const useUsageStore = create<UsageState>((set, get) => ({
  byProvider: {},

  applyHostSnapshot: (payload) => {
    if (!payload || typeof payload !== 'object') return
    const record = payload as Record<string, unknown>
    // Both pollers publish on the same topic. Without keying by provider the
    // Codex tick would overwrite the Claude figures ~every 150s, and a Claude
    // session would show whichever landed last.
    const provider: UsageProvider = record.provider === 'codex' ? 'codex' : 'claude'
    const fiveHour = asWindow(record.fiveHour)
    const sevenDay = asWindow(record.sevenDay)
    // A snapshot with neither window is the host saying there is no login for
    // this provider; keeping the previous figures would show quota for an
    // account that is no longer the one in use.
    dlog('USAGE', `${provider} snapshot 5h=${fiveHour?.utilization ?? 'none'} 7d=${sevenDay?.utilization ?? 'none'}`)
    set(state => ({
      byProvider: {
        ...state.byProvider,
        [provider]: {
          fiveHour,
          sevenDay,
          extraUsage: (record.extraUsage ?? null) as UsageSnapshot['extraUsage'],
          receivedAt: Date.now(),
        },
      },
    }))
  },

  /**
   * The connect-time pull: `{ claude: {...}, codex: {...} }`. Each value
   * carries its own `provider` field, so the entries go through the same path
   * as a broadcast and the map keys are only there to make it a map.
   */
  applyHostSnapshotMap: (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
    const entries = Object.entries(payload as Record<string, unknown>)
    dlog('USAGE', `pulled ${entries.length} provider snapshot(s) from host`)
    for (const [key, snapshot] of entries) {
      if (!snapshot || typeof snapshot !== 'object') continue
      // Trust the key only when the snapshot itself doesn't say. An older host
      // could conceivably key the map without stamping the value.
      const record = snapshot as Record<string, unknown>
      get().applyHostSnapshot(
        typeof record.provider === 'string' ? record : { ...record, provider: key },
      )
    }
  },

  clear: () => set({ byProvider: {} }),
}))
