import { AppState } from 'react-native'
import type { ClaudeChannel } from '@/api/channels/claude'
import { isSdkAgentSession } from '@/types'
import { recoveryEvent } from '@/utils/recovery-diagnostics'
import { useClaudeStore } from './claude-store'
import { useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'

const REFRESH_MS = 10_000
const OFFSCREEN_REFRESH_MS = 60_000
const MAX_CONCURRENT = 3
const refreshListeners = new Set<(force?: boolean) => Promise<void>>()
const visibleLists = new Set<{ channel: ClaudeChannel; ids: Set<string> | null }>()

/** Focused lists retain fast badge updates; covered navigation screens do not. */
export function watchSessionActivity(channel: ClaudeChannel, ids: string[] | null): () => void {
  const interest = { channel, ids: ids === null ? null : new Set(ids) }
  visibleLists.add(interest)
  for (const refresh of refreshListeners) refresh(false)
  return () => { visibleLists.delete(interest) }
}

/** Refresh badges when the workspace list is opened or explicitly refreshed. */
export async function refreshSessionActivity(force = true): Promise<void> {
  await Promise.all([...refreshListeners].map(refresh => refresh(force)))
}

/** Bootstrap quiet, already-running sessions; live events remain the fast path.
 * Metadata only: never fetch a transcript or start/resume a session for a badge.
 */
export function subscribeSessionActivity(claude: ClaudeChannel): () => void {
  let disposed = false
  let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  let timer: ReturnType<typeof setTimeout> | null = null
  let refreshing = false
  let refreshAgain = false
  let forceAgain = false
  const checkedAt = new Map<string, number>()
  const sessionIds = () => useWorkspaceStore.getState().terminals.filter(isSdkAgentSession).map(item => item.id)
  const isCurrent = () => {
    const connection = useConnectionStore.getState()
    const workspace = useWorkspaceStore.getState()
    return !disposed && foreground && connection.channels?.claude === claude &&
      (!connection.client?.supportsProfileContext || (connection.profileStatus === 'ready' &&
        connection.selectedProfileId === workspace.activeLocalProfileId &&
        (workspace.loadStatus === 'ok' || workspace.loadStatus === 'empty')))
  }

  const isVisible = (id: string) => useClaudeStore.getState().activeSessionId === id ||
    [...visibleLists].some(list => list.channel === claude && (list.ids === null || list.ids.has(id)))

  async function refresh(force = false) {
    if (!isCurrent()) return
    if (refreshing) { refreshAgain = true; forceAgain ||= force; return }
    if (timer) { clearTimeout(timer); timer = null }
    refreshing = true
    const wanted = sessionIds()
    const started = Date.now()
    let queried = 0
    let cursor = 0
    try {
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, wanted.length) }, async () => {
        while (cursor < wanted.length && isCurrent()) {
          const id = wanted[cursor++]
          if (!sessionIds().includes(id)) continue
          const interval = isVisible(id) ? REFRESH_MS : OFFSCREEN_REFRESH_MS
          if (!force && Date.now() - (checkedAt.get(id) ?? -Infinity) < interval) continue
          checkedAt.set(id, Date.now())
          queried++
          const before = useClaudeStore.getState().sessions[id]
          try {
            const meta = await claude.getSessionMeta(id)
            if (!isCurrent() || !sessionIds().includes(id)) continue
            const unchanged = useClaudeStore.getState().sessions[id] === before
            // Successful null means the selected execution host no longer has
            // this runtime (e.g. BAT restarted). It is different from an RPC
            // error/timeout and must clear a cached pre-restart working badge.
            if (meta === null) {
              if (unchanged) useClaudeStore.getState().handleRuntimeMissing(id)
              continue
            }
            // A stream/status/result received after this request began is
            // newer evidence. Never let a late idle poll overwrite it.
            if (!meta || typeof meta !== 'object') continue
            // Output time is independently monotonic and still useful while
            // live deltas are changing the transcript during this read.
            if (meta.lastDataAt !== undefined) useClaudeStore.getState().handleLastDataAt(id, meta.lastDataAt)
            if (!unchanged) continue
            // Older hosts may return usage-only metadata. It is not evidence
            // that the session is idle, and must not erase a live phase.
            if (typeof meta.isStreaming !== 'boolean' && !meta.runtimeStatus && meta.lastDataAt === undefined) continue
            useClaudeStore.getState().handleStatus(id, meta)
          } catch { /* Retry on the next sweep; a failed read is not idle. */ }
        }
      }))
    } finally {
      refreshing = false
      if (queried) recoveryEvent('session.activity.sweep', {
        force, total: wanted.length, queried, elapsedMs: Date.now() - started,
      })
      if (isCurrent()) {
        const delay = refreshAgain ? 0 : REFRESH_MS
        const nextForce = forceAgain
        refreshAgain = false
        forceAgain = false
        timer = setTimeout(() => { refresh(nextForce) }, delay)
      }
    }
  }

  let idsKey = JSON.stringify(sessionIds())
  let wasCurrent = isCurrent()
  const checkWorkspace = () => {
    const current = isCurrent()
    const becameReady = current && !wasCurrent
    wasCurrent = current
    const next = JSON.stringify(sessionIds())
    if (next === idsKey && !becameReady) return
    idsKey = next
    for (const id of checkedAt.keys()) if (!sessionIds().includes(id)) checkedAt.delete(id)
    refresh()
  }
  const unsubscribeWorkspace = useWorkspaceStore.subscribe(checkWorkspace)
  const unsubscribeConnection = useConnectionStore.subscribe(checkWorkspace)
  const appState = AppState.addEventListener('change', state => {
    foreground = state === 'active'
    if (!foreground) {
      if (timer) { clearTimeout(timer); timer = null }
      return
    }
    refresh(true)
  })
  refreshListeners.add(refresh)
  refresh()
  return () => {
    disposed = true
    refreshListeners.delete(refresh)
    if (timer) clearTimeout(timer)
    appState.remove()
    unsubscribeWorkspace()
    unsubscribeConnection()
  }
}
