import { AppState } from 'react-native'
import type { ClaudeChannel } from '@/api/channels/claude'
import { isSdkAgentSession } from '@/types'
import { useClaudeStore } from './claude-store'
import { useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'

const REFRESH_MS = 10_000
const MAX_CONCURRENT = 3
const refreshListeners = new Set<() => Promise<void>>()

/** Refresh badges when the workspace list is opened or explicitly refreshed. */
export async function refreshSessionActivity(): Promise<void> {
  await Promise.all([...refreshListeners].map(refresh => refresh()))
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
  const sessionIds = () => useWorkspaceStore.getState().terminals.filter(isSdkAgentSession).map(item => item.id)
  const isCurrent = () => !disposed && foreground && useConnectionStore.getState().channels?.claude === claude

  async function refresh() {
    if (!isCurrent()) return
    if (refreshing) { refreshAgain = true; return }
    if (timer) { clearTimeout(timer); timer = null }
    refreshing = true
    const wanted = sessionIds()
    let cursor = 0
    try {
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, wanted.length) }, async () => {
        while (cursor < wanted.length && isCurrent()) {
          const id = wanted[cursor++]
          if (!sessionIds().includes(id)) continue
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
      if (isCurrent()) {
        const delay = refreshAgain ? 0 : REFRESH_MS
        refreshAgain = false
        timer = setTimeout(() => { refresh() }, delay)
      }
    }
  }

  let idsKey = JSON.stringify(sessionIds())
  const unsubscribeWorkspace = useWorkspaceStore.subscribe(() => {
    const next = JSON.stringify(sessionIds())
    if (next === idsKey) return
    idsKey = next
    refresh()
  })
  const appState = AppState.addEventListener('change', state => {
    foreground = state === 'active'
    if (!foreground) {
      if (timer) { clearTimeout(timer); timer = null }
      return
    }
    refresh()
  })
  refreshListeners.add(refresh)
  refresh()
  return () => {
    disposed = true
    refreshListeners.delete(refresh)
    if (timer) clearTimeout(timer)
    appState.remove()
    unsubscribeWorkspace()
  }
}
