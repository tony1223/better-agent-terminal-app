/**
 * One copy of "what is each agent session doing right now", shared by every
 * screen that lists sessions.
 *
 * The list screens already paid for this data and threw most of it away:
 * TerminalListScreen fetched a full session snapshot per row and kept only the
 * first user prompt, while the row's status dot reported `pid` — process alive,
 * which is true of a finished session and a busy one alike. Meanwhile the
 * workspace detail pane fetched nothing and showed neither.
 *
 * `useClaudeStore` can't serve this: only ClaudeScreen and its children
 * subscribe to it, and it's only populated for sessions you have opened. A list
 * has to ask the host about sessions it has never rendered, so this store owns
 * the polling and the screens just read it.
 */

import { create } from 'zustand'
import { useConnectionStore } from '@/stores/connection-store'
import { isCompactSummaryMessage } from '@/utils/compact-summary'
import { deriveAgentActivity, runtimePhaseLabel, type SessionActivity } from '@/utils/session-status'
import type { ClaudeMessage } from '@/types'

export interface SessionRuntime {
  activity: SessionActivity
  /** 'queued', 'waiting for api'… — null while simply streaming. */
  phase: string | null
  /** First real user prompt, as a one-glance "what is this session about". */
  preview: string
  model?: string
  numTurns?: number
  /** Epoch ms, so callers can skip refetching something we just fetched. */
  fetchedAt: number
}

interface SessionRuntimeState {
  runtimes: Record<string, SessionRuntime>
  refresh: (sessionIds: string[], options?: { maxAgeMs?: number }) => Promise<void>
}

/**
 * Ids with a request out right now. Three screens can mount focus effects at
 * once (tab switch pushes a detail screen, which pushes a session); without
 * this each would fire its own snapshot request for the same rows.
 */
const inFlight = new Set<string>()

/**
 * How many snapshots to have in flight at once.
 *
 * This fan-out is expensive by nature: `agent:get-session-state` returns a
 * session's *entire* message list, and the list wants one preview line and a
 * status flag off the back of it. The host has no lighter call that carries
 * `isStreaming` — `getSessionMeta` omits it — so there is nothing cheaper to
 * ask for.
 *
 * That was tolerable when only the active workspace's sessions were polled.
 * Once the list went cross-workspace it became "pull every transcript on the
 * box, at once, over a phone's socket", and ClaudeScreen is competing for that
 * same connection — it abandons its own history load after six seconds and
 * renders an empty conversation. So: a small pool, and rows fill in as they
 * land rather than in one batch at the end.
 */
const MAX_CONCURRENT_FETCHES = 4

/** Run `worker` over `items`, at most `limit` at a time, in order. */
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        await worker(items[cursor++])
      }
    }),
  )
}

/**
 * A session resumed from a compacted transcript starts with the summary, and
 * 15k characters of it is not a useful row preview.
 */
function firstUserPrompt(messages: unknown[]): string {
  const found = messages.find(
    (m): m is ClaudeMessage => !!m
      && typeof m === 'object'
      && 'role' in m
      && (m as ClaudeMessage).role === 'user'
      && !isCompactSummaryMessage(
        'user',
        (m as ClaudeMessage).content ?? '',
        (m as ClaudeMessage).isCompactSummary,
      ),
  )
  return found?.content?.trim() ?? ''
}

export const useSessionRuntimeStore = create<SessionRuntimeState>((set, get) => ({
  runtimes: {},

  refresh: async (sessionIds, options) => {
    const channels = useConnectionStore.getState().channels
    if (!channels) return

    const maxAgeMs = options?.maxAgeMs ?? 0
    const now = Date.now()
    const existing = get().runtimes

    const wanted = sessionIds.filter(id => {
      if (inFlight.has(id)) return false
      if (maxAgeMs <= 0) return true
      const cached = existing[id]
      return !cached || now - cached.fetchedAt >= maxAgeMs
    })

    // Drop rows for sessions that no longer exist, even when there is nothing
    // to fetch — otherwise a closed session keeps its last known status.
    const live = new Set(sessionIds)
    set(state => {
      const kept = Object.keys(state.runtimes).filter(id => live.has(id))
      if (kept.length === Object.keys(state.runtimes).length) return {}
      return { runtimes: Object.fromEntries(kept.map(id => [id, state.runtimes[id]])) }
    })

    if (wanted.length === 0) return
    wanted.forEach(id => inFlight.add(id))

    try {
      await pooled(wanted, MAX_CONCURRENT_FETCHES, async (id) => {
        let fetched: SessionRuntime | null = null
        try {
          const snapshot = await channels.claude.getSessionState(id)
          fetched = {
            activity: deriveAgentActivity(snapshot),
            phase: runtimePhaseLabel(snapshot),
            preview: firstUserPrompt(snapshot?.messages ?? []),
            model: snapshot?.meta?.model ?? snapshot?.model,
            numTurns: snapshot?.meta?.numTurns,
            fetchedAt: Date.now(),
          }
        } catch {
          // A failed request is not evidence the session stopped, so keep the
          // last known activity and only mark it unknown if we never had one.
          fetched = null
        }

        set(state => {
          // The session may have been closed while its snapshot was in flight;
          // re-adding it here would resurrect a row the prune already dropped.
          if (fetched && !(id in state.runtimes) && !live.has(id)) return {}
          if (!fetched) {
            return id in state.runtimes
              ? {}
              : { runtimes: { ...state.runtimes, [id]: { activity: 'unknown' as const, phase: null, preview: '', fetchedAt: Date.now() } } }
          }
          // An empty preview from a session that had one means the fetch raced
          // a reset, not that the prompt vanished.
          const runtime = fetched.preview
            ? fetched
            : { ...fetched, preview: state.runtimes[id]?.preview ?? '' }
          return { runtimes: { ...state.runtimes, [id]: runtime } }
        })
      })
    } finally {
      wanted.forEach(id => inFlight.delete(id))
    }
  },
}))
