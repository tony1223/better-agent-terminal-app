/**
 * What a session row should say about a session.
 *
 * The list screens used to show a dot driven by `TerminalInstance.pid` — is
 * the process alive. For an agent session that answers a question nobody
 * asks: an idle agent and one twelve tool-calls deep into a turn are both
 * "alive". The question on a phone is "is it done yet", and the answer is
 * already in the session snapshot the list fetches anyway.
 */

import type { SessionStateSnapshot, TerminalInstance } from '@/types'

export type SessionActivity =
  // The agent is mid-turn: streaming, or the host is preparing/queueing a request.
  | 'working'
  // A live session sitting waiting for input.
  | 'idle'
  // Process is gone (plain terminals) or the host has no session for this id.
  | 'stopped'
  // A session we have not polled yet — deliberately distinct from 'idle' so a
  // row never claims a session is finished when we simply have not looked.
  | 'unknown'

/**
 * Host-side turn phases that mean work is in flight. `runtimeStatus` goes null
 * once the model starts responding, at which point `isStreaming` takes over —
 * so the two together, not either alone, cover a whole turn.
 */
const ACTIVE_RUNTIME_STATUSES = new Set(['starting', 'queued', 'waiting_for_api', 'compacting'])

export function isActiveRuntimeStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE_RUNTIME_STATUSES.has(status)
}

/**
 * Derive a row's activity from the snapshot the host returned for it.
 *
 * `snapshot === null` means the host answered but has no such session; passing
 * `undefined` means we never asked.
 */
export function deriveAgentActivity(snapshot: SessionStateSnapshot | null | undefined): SessionActivity {
  if (snapshot === undefined) return 'unknown'
  if (snapshot === null) return 'stopped'
  if (snapshot.isStreaming === true) return 'working'
  if (isActiveRuntimeStatus(snapshot.meta?.runtimeStatus)) return 'working'
  return 'idle'
}

/**
 * A plain shell has no agent turn to report, so the process really is the
 * whole story there.
 */
export function derivePtyActivity(terminal: TerminalInstance): SessionActivity {
  return terminal.pid ? 'idle' : 'stopped'
}

/**
 * The phase word to show beside a working session ("queued", "compacting"…).
 * Returns null while the model is simply streaming, where the activity label
 * already says everything useful.
 */
export function runtimePhaseLabel(snapshot: SessionStateSnapshot | null | undefined): string | null {
  const status = snapshot?.meta?.runtimeStatus
  return isActiveRuntimeStatus(status) ? String(status).replace(/_/g, ' ') : null
}
