/**
 * What a session row should say about a session.
 *
 * The list used to show a dot driven by `TerminalInstance.pid`. For an agent
 * session that answers a question nobody asks: an idle agent and one twelve
 * tool-calls deep into a turn are both "alive". What you want to know on a
 * phone is whether it is done yet.
 *
 * The first attempt at this polled `agent:get-session-state` per row. That was
 * wrong twice over. It returns no activity at all — the host's
 * `session_state_from_notification_snapshot` carries `active`/`isResting`/
 * `model` and neither `isStreaming` nor `meta` — and it was never needed,
 * because `subscribeClaudeEvents` (App.tsx) subscribes to `agent:stream` and
 * `agent:status` for *every* session, not just the open one. A working session
 * announces itself continuously; we only had to listen.
 */

import type { SessionMeta, TerminalInstance } from '@/types'

export type SessionActivity =
  // The agent is mid-turn: streaming, or the host is preparing/queueing a request.
  | 'working'
  // Nothing in flight — waiting on you.
  | 'idle'
  // Process is gone. Plain terminals only; an agent session has no pid to lose.
  | 'stopped'

/**
 * Host-side turn phases that mean work is in flight. `runtimeStatus` goes null
 * once the model starts responding, at which point `isStreaming` takes over —
 * so the two together, not either alone, cover a whole turn.
 */
const ACTIVE_RUNTIME_STATUSES = new Set(['starting', 'queued', 'waiting_for_api', 'compacting'])

export function isActiveRuntimeStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE_RUNTIME_STATUSES.has(status)
}

/** The slice of a claude-store session that says whether it is busy. */
export interface LiveSessionActivity {
  isStreaming?: boolean
  meta?: Pick<SessionMeta, 'runtimeStatus'> | null
}

/**
 * Derive activity from the events we have already received for this session.
 *
 * `undefined` means no event has arrived since the app connected. That reads as
 * idle rather than unknown on purpose: a session with a turn in flight emits
 * continuously, so silence is evidence of *not* working. The row can be at most
 * a second or so behind a turn that began before we connected.
 */
export function deriveAgentActivity(live: LiveSessionActivity | undefined): SessionActivity {
  if (!live) return 'idle'
  if (live.isStreaming === true) return 'working'
  if (isActiveRuntimeStatus(live.meta?.runtimeStatus)) return 'working'
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
 * Null while the model is simply streaming, where the activity label already
 * says everything useful.
 */
export function runtimePhaseLabel(live: LiveSessionActivity | undefined): string | null {
  const status = live?.meta?.runtimeStatus
  return isActiveRuntimeStatus(status) ? String(status).replace(/_/g, ' ') : null
}
