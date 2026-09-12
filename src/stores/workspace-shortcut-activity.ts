import { AppState } from 'react-native'
import { createChannels } from '@/api/channels'
import { isSdkAgentSession, type TerminalInstance } from '@/types'
import { isActiveRuntimeStatus } from '@/utils/session-status'
import { useConnectionStore, type ProfileContext } from './connection-store'

export interface WorkspaceActivityTarget {
  profileId: string
  workspaceId: string
}

export interface WorkspaceActivitySummary {
  total: number
  working: number
}

export const workspaceActivityKey = (target: WorkspaceActivityTarget) =>
  JSON.stringify([target.profileId, target.workspaceId])

/** Read the visible shortcuts without switching the selected profile or attaching
 * to conversations. Each sweep owns and releases its temporary profile context.
 */
export function subscribeWorkspaceShortcutActivity(
  targets: WorkspaceActivityTarget[],
  onSummary: (key: string, summary: WorkspaceActivitySummary) => void,
) {
  const { client, channels } = useConnectionStore.getState()
  let disposed = false
  let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let refreshAgain = false
  const groups = new Map<string, Set<string>>()
  for (const target of targets) {
    if (!groups.has(target.profileId)) groups.set(target.profileId, new Set())
    groups.get(target.profileId)!.add(target.workspaceId)
  }
  const isCurrent = () => {
    const state = useConnectionStore.getState()
    return !disposed && foreground && state.status === 'connected' &&
      state.client === client && state.channels === channels
  }

  async function sweep() {
    if (!client?.supportsProfileContext) return
    for (const [profileId, workspaceIds] of groups) {
      if (!isCurrent()) return
      let context: ProfileContext | undefined
      try {
        context = await client.invokeParams<ProfileContext>('profile:open', { profileId })
        if (!isCurrent() || !context.contextId || context.profileId !== profileId || context.status !== 'ready') continue
        const scoped = createChannels(client.scoped(context.contextId), client)
        const raw = await scoped.workspace.load(profileId)
        if (!isCurrent()) continue
        // Invalid/unavailable snapshots are not evidence that work has stopped.
        if (raw == null) continue
        const snapshot = JSON.parse(raw)
        if (!Array.isArray(snapshot?.terminals)) continue
        const terminals: TerminalInstance[] = snapshot.terminals.filter((item: TerminalInstance) =>
          item && typeof item.id === 'string' && workspaceIds.has(item.workspaceId))
        const summaries = new Map([...workspaceIds].map(id => [id, { total: 0, working: 0 }]))
        const failed = new Set<string>()
        for (const terminal of terminals) summaries.get(terminal.workspaceId)!.total++
        const agents = terminals.filter(isSdkAgentSession)
        let cursor = 0
        await Promise.all(Array.from({ length: Math.min(3, agents.length) }, async () => {
          while (cursor < agents.length && isCurrent()) {
            const terminal = agents[cursor++]
            try {
              const meta = await scoped.claude.getSessionMeta(terminal.id)
              if (meta === null) continue // Explicitly missing runtime.
              if (!meta || (typeof meta.isStreaming !== 'boolean' && !meta.runtimeStatus)) {
                failed.add(terminal.workspaceId)
              } else if (meta.isStreaming === true || isActiveRuntimeStatus(meta.runtimeStatus)) {
                summaries.get(terminal.workspaceId)!.working++
              }
            } catch { failed.add(terminal.workspaceId) }
          }
        }))
        if (!isCurrent()) continue
        for (const [workspaceId, summary] of summaries) {
          if (!failed.has(workspaceId)) onSummary(workspaceActivityKey({ profileId, workspaceId }), summary)
        }
      } catch { /* Retry quietly; a disconnected profile is not an idle workspace. */ }
      finally {
        if (context?.contextId) {
          await client.invokeParams('profile:close', { contextId: context.contextId }).catch(() => {})
        }
      }
    }
  }

  function refresh(): Promise<void> {
    if (!isCurrent() || !client?.supportsProfileContext || groups.size === 0) return Promise.resolve()
    if (inFlight) { refreshAgain = true; return inFlight }
    if (timer) clearTimeout(timer)
    inFlight = sweep().finally(() => {
      inFlight = undefined
      if (isCurrent()) {
        timer = setTimeout(() => { refresh() }, refreshAgain ? 0 : 10_000)
        refreshAgain = false
      }
    })
    return inFlight
  }

  const appState = AppState.addEventListener('change', state => {
    foreground = state === 'active'
    if (foreground) refresh()
    else if (timer) clearTimeout(timer)
  })
  refresh()
  return {
    refresh,
    dispose: () => {
      disposed = true
      if (timer) clearTimeout(timer)
      appState.remove()
    },
  }
}
