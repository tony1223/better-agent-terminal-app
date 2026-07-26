/**
 * The one-line "what is this session about" shown under each session row.
 *
 * A session's opening prompt is the only part of it that never changes, which
 * makes it the right thing to summarise a row with — and means this can be
 * fetched once per session and kept.
 *
 * This deliberately does *not* carry activity. The first version did, via
 * `agent:get-session-state` per row, and it was wrong on both counts:
 *
 *   - The host's snapshot has no activity in it. `session_state_from_
 *     notification_snapshot` returns active/permissionMode/model/isResting and
 *     no `isStreaming` or `meta`, so every row rendered "ready" forever.
 *   - It cost a full transcript per row to learn one line. Once the session
 *     list went cross-workspace that became "download every conversation on the
 *     host, at once, over a phone's socket" — while ClaudeScreen was competing
 *     for the same connection and giving up on its own history after six
 *     seconds.
 *
 * Activity now comes from `useClaudeStore`, which App.tsx subscribes to
 * globally: a working session emits `agent:stream` continuously whether or not
 * you have it open. It was already arriving; nobody was reading it.
 */

import { create } from 'zustand'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { isCompactSummaryMessage } from '@/utils/compact-summary'
import type { ClaudeMessage } from '@/types'

interface SessionPreviewState {
  previews: Record<string, string>
  /** Fetch previews for any of these ids we don't already have. */
  load: (sessionIds: string[]) => Promise<void>
  /** Drop a cached preview, for when a session is reset rather than closed. */
  forget: (sessionId: string) => void
}

/**
 * Ids with a request out. Several screens can mount focus effects at once — a
 * tab switch pushes a detail screen, which pushes a session — and without this
 * each would ask for the same rows.
 */
const inFlight = new Set<string>()

/** At most this many archive reads at a time, so the socket stays usable. */
const MAX_CONCURRENT_FETCHES = 4

/**
 * How far into the transcript to look for the opening prompt. A session resumed
 * from a compacted one begins with the summary, so the real first prompt can be
 * a turn or two down.
 */
const PREVIEW_SCAN_DEPTH = 4

const PREVIEW_MAX_CHARS = 160

/** Run `worker` over `items`, at most `limit` at a time. */
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

function asClaudeMessage(value: unknown): ClaudeMessage | null {
  return !!value && typeof value === 'object' && 'role' in value ? (value as ClaudeMessage) : null
}

/**
 * The first thing the user actually typed. A 15k-character compaction summary
 * is technically the first user message and tells you nothing about the
 * session, so it is skipped in favour of what came after it.
 */
export function firstUserPrompt(messages: unknown[]): string {
  let fallback = ''
  for (const raw of messages) {
    const message = asClaudeMessage(raw)
    const content = message?.content?.trim()
    if (!message || !content) continue
    if (message.role !== 'user') continue
    if (isCompactSummaryMessage('user', message.content ?? '', message.isCompactSummary)) {
      // Better than nothing if the whole window turns out to be summary.
      fallback ||= content
      continue
    }
    return content.slice(0, PREVIEW_MAX_CHARS)
  }
  return fallback.slice(0, PREVIEW_MAX_CHARS)
}

/**
 * Which sessions still exist — asked of the workspace store rather than taken
 * from the caller's list.
 *
 * Callers only know their own slice: the workspace detail pane passes one
 * workspace's sessions, and evicting everything else on its behalf would make
 * two screens fight over the cache and refetch each other's rows forever. It
 * also has to be read at the moment of use, not captured at the start of a
 * load, or a session closed while its read was in flight comes back.
 */
function livingSessionIds(): Set<string> {
  return new Set(useWorkspaceStore.getState().terminals.map(item => item.id))
}

export const useSessionPreviewStore = create<SessionPreviewState>((set, get) => ({
  previews: {},

  forget: (sessionId) => set(state => {
    if (!(sessionId in state.previews)) return {}
    const rest = { ...state.previews }
    delete rest[sessionId]
    return { previews: rest }
  }),

  load: async (sessionIds) => {
    const channels = useConnectionStore.getState().channels
    if (!channels) return

    // Forget sessions that no longer exist, so closing one drops its line
    // rather than leaving the cache to grow for the life of the app.
    set(state => {
      const live = livingSessionIds()
      const kept = Object.keys(state.previews).filter(id => live.has(id))
      if (kept.length === Object.keys(state.previews).length) return {}
      return { previews: Object.fromEntries(kept.map(id => [id, state.previews[id]])) }
    })

    const known = get().previews
    const wanted = sessionIds.filter(id => !(id in known) && !inFlight.has(id))
    if (wanted.length === 0) return
    wanted.forEach(id => inFlight.add(id))

    try {
      await pooled(wanted, MAX_CONCURRENT_FETCHES, async (id) => {
        let preview: string
        try {
          const archived = await channels.claude.loadArchived(id, 0, PREVIEW_SCAN_DEPTH)
          preview = firstUserPrompt(archived?.messages ?? [])
        } catch {
          // A failed read isn't evidence the session has no prompt; leave it
          // uncached so the next visit tries again.
          return
        }
        if (!preview) return

        set(state => {
          // The session may have been closed while this was in flight; adding
          // it now would resurrect a row the prune already dropped.
          if (!livingSessionIds().has(id)) return {}
          return { previews: { ...state.previews, [id]: preview } }
        })
      })
    } finally {
      wanted.forEach(id => inFlight.delete(id))
    }
  },
}))
