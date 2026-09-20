/**
 * Keep the roster of every worker panel in a list fresh enough for its row.
 *
 * The host has no "is this panel alive" answer; the row derives it from the
 * per-process probe in the worker store. Lists remount on every back-press, so
 * the refresh is throttled per panel rather than fired on each mount.
 */

import { useEffect } from 'react'
import type { TerminalInstance } from '@/types'
import { useWorkerStore } from '@/stores/worker-store'

const ROSTER_MAX_AGE_MS = 10_000

export function useWorkerRosters(terminals: TerminalInstance[], connected: boolean): void {
  const key = terminals
    .filter(item => item.procfilePath)
    .map(item => `${item.id}\u0001${item.procfilePath}`)
    .join('\0')
  useEffect(() => {
    if (!connected || !key) return
    for (const pair of key.split('\0')) {
      const [id, procfilePath] = pair.split('\u0001')
      useWorkerStore.getState().refresh(id, procfilePath, { maxAgeMs: ROSTER_MAX_AGE_MS }).catch(() => undefined)
    }
  }, [connected, key])
}
