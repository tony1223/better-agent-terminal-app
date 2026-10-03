/** Latest readable message, fetched in bounded tail pages rather than full snapshots. */
import { create } from 'zustand'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useClaudeStore } from '@/stores/claude-store'
import { latestMessagePreview } from '@/utils/session-preview'

interface SessionPreviewState {
  previews: Record<string, string>
  timestamps: Record<string, number>
  fetchedAt: Record<string, number>
  load: (sessionIds: string[], isVisible?: () => boolean) => Promise<void>
  forget: (sessionId: string) => void
}

const requestsByChannels = new WeakMap<object, Map<string, symbol>>()
const MAX_CONCURRENT_FETCHES = 4
const PREVIEW_SCAN_DEPTH = 8
const MAX_SCAN_PAGES = 3
export const PREVIEW_REFRESH_MS = 15_000

async function pooled<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) await worker(items[cursor++])
    }),
  )
}

function livingSessionIds(): Set<string> {
  return new Set(useWorkspaceStore.getState().terminals.map(item => item.id))
}

export const useSessionPreviewStore = create<SessionPreviewState>(
  (set, get) => ({
    previews: {},
    timestamps: {},
    fetchedAt: {},

    forget: sessionId => {
      const channels = useConnectionStore.getState().channels
      if (channels) requestsByChannels.get(channels)?.delete(sessionId)
      set(state => {
        const previews = { ...state.previews }
        const timestamps = { ...state.timestamps }
        const fetchedAt = { ...state.fetchedAt }
        delete previews[sessionId]
        delete timestamps[sessionId]
        delete fetchedAt[sessionId]
        return { previews, timestamps, fetchedAt }
      })
    },

    load: async (sessionIds, isVisible = () => true) => {
      const connection = useConnectionStore.getState()
      const { channels } = connection
      if (
        !channels ||
        connection.status !== 'connected' ||
        (connection.client?.supportsProfileContext &&
          connection.profileStatus !== 'ready')
      )
        return
      const scope = useClaudeStore.getState().scopeKey
      const inFlight =
        requestsByChannels.get(channels) ?? new Map<string, symbol>()
      requestsByChannels.set(channels, inFlight)
      const current = () => {
        const state = useConnectionStore.getState()
        return (
          isVisible() &&
          state.channels === channels &&
          state.status === 'connected' &&
          (!state.client?.supportsProfileContext ||
            state.profileStatus === 'ready') &&
          useClaudeStore.getState().scopeKey === scope
        )
      }

      // Prune against all workspaces, not only the caller's visible slice.
      set(state => {
        const live = livingSessionIds()
        if (
          [
            ...Object.keys(state.previews),
            ...Object.keys(state.fetchedAt),
          ].every(id => live.has(id))
        )
          return {}
        const keep = <T>(record: Record<string, T>) =>
          Object.fromEntries(
            Object.entries(record).filter(([id]) => live.has(id)),
          )
        return {
          previews: keep(state.previews),
          timestamps: keep(state.timestamps),
          fetchedAt: keep(state.fetchedAt),
        }
      })
      const wanted = [...new Set(sessionIds)].filter(
        id =>
          livingSessionIds().has(id) &&
          !inFlight.has(id) &&
          (get().fetchedAt[id] === undefined ||
            Date.now() - get().fetchedAt[id] >= PREVIEW_REFRESH_MS),
      )
      const token = Symbol('preview read')
      wanted.forEach(id => inFlight.set(id, token))
      try {
        await pooled(wanted, MAX_CONCURRENT_FETCHES, async id => {
          const valid = () =>
            current() &&
            livingSessionIds().has(id) &&
            inFlight.get(id) === token
          if (!valid()) return
          try {
            let preview = null
            for (let page = 0; page < MAX_SCAN_PAGES; page++) {
              // Offset zero means the newest page, ordered oldest-to-newest.
              const archived = await channels.claude.loadArchived(
                id,
                page * PREVIEW_SCAN_DEPTH,
                PREVIEW_SCAN_DEPTH,
              )
              if (!valid()) return
              preview = latestMessagePreview(archived?.messages ?? [])
              if (preview || !archived?.hasMore) break
            }
            set(state => ({
              // Tool-only windows retain the last readable message, never a tool dump.
              previews: preview
                ? { ...state.previews, [id]: preview.text }
                : state.previews,
              timestamps: preview
                ? { ...state.timestamps, [id]: preview.timestamp }
                : state.timestamps,
              fetchedAt: { ...state.fetchedAt, [id]: Date.now() },
            }))
          } catch {
            /* Keep the last preview; retry failed reads on the next refresh. */
          }
        })
      } finally {
        wanted.forEach(id => {
          if (inFlight.get(id) === token) inFlight.delete(id)
        })
      }
    },
  }),
)
