/**
 * Workspace Store - manages workspaces and terminals
 * Data is loaded from BAT server via workspace:load channel
 */

import { create } from 'zustand'
import type {
  Workspace,
  TerminalInstance,
  AppState,
  ProfileEntry,
  AgentPresetId,
} from '@/types'
import { getAgentPreset } from '@/types'
import { useConnectionStore } from './connection-store'

const SDK_AGENT_PRESETS = new Set<AgentPresetId>([
  'claude-code',
  'claude-code-v2',
  'claude-code-worktree',
  'codex-agent',
  'codex-agent-worktree',
  'openai-agent',
])

/**
 * Result of the last `load()` attempt.
 * - 'ok'         : data loaded with at least one workspace
 * - 'empty'      : server returned a valid snapshot with zero workspaces
 * - 'no-window'  : server returned null (connection isn't bound to a window —
 *                  typically because the saved QR predates window-context support)
 * - 'no-channel' : not connected yet
 * - 'parse-error': server returned invalid JSON
 * - 'rpc-error'  : invoke threw (timeout, channel-not-exposed, etc.)
 */
export type WorkspaceLoadStatus =
  | 'idle'
  | 'ok'
  | 'empty'
  | 'no-window'
  | 'no-channel'
  | 'parse-error'
  | 'rpc-error'

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  terminals: TerminalInstance[]
  activeTerminalId: string | null
  profiles: ProfileEntry[]
  activeProfileIds: string[]
  loadStatus: WorkspaceLoadStatus
  loadError: string | null

  // Actions
  load: () => Promise<void>
  loadActiveProfileWorkspace: () => Promise<void>
  loadProfileWorkspace: (profileId: string) => Promise<void>
  applySnapshot: (raw: string) => void
  applyReload: (payload: unknown) => void
  applyState: (state: AppState) => void
  applyProfileChanged: (payload: unknown) => void
  switchWorkspace: (id: string) => void
  setActiveTerminal: (id: string) => void
  requestAddSession: (workspaceId: string, agentPreset?: AgentPresetId) => Promise<TerminalInstance>
  requestCloseSession: (terminalId: string) => Promise<void>

  // Computed helpers
  getWorkspaceTerminals: (workspaceId: string) => TerminalInstance[]
  getActiveWorkspace: () => Workspace | undefined
  getActiveTerminal: () => TerminalInstance | undefined
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  terminals: [],
  activeTerminalId: null,
  profiles: [],
  activeProfileIds: [],
  loadStatus: 'idle',
  loadError: null,

  load: async () => {
    const channels = useConnectionStore.getState().channels
    if (!channels) {
      set({ loadStatus: 'no-channel', loadError: null })
      return
    }

    await loadProfileSummary(channels, ({ profiles, activeProfileIds }) => {
      set({
        profiles,
        activeProfileIds,
      })
    })

    let raw: string | null
    try {
      raw = await channels.workspace.load()
    } catch (e) {
      const loaded = await loadFromActiveProfileSnapshot(channels, get().applyState)
      if (!loaded) {
        set({ loadStatus: 'rpc-error', loadError: String(e) })
      }
      return
    }

    if (raw == null) {
      set({ workspaces: [], terminals: [], loadStatus: 'no-window', loadError: null })
      return
    }

    get().applySnapshot(raw)
  },

  loadActiveProfileWorkspace: async () => {
    const channels = useConnectionStore.getState().channels
    if (!channels) {
      set({ loadStatus: 'no-channel', loadError: null })
      return
    }

    let summary: { profiles: ProfileEntry[]; activeProfileIds: string[] } = {
      profiles: [],
      activeProfileIds: [],
    }
    await loadProfileSummary(channels, value => {
      summary = value
      set(value)
    })

    const profilesById = new Map(summary.profiles.map(profile => [profile.id, profile]))
    const profileId = summary.activeProfileIds.find(id => profilesById.get(id)?.type !== 'remote')
      ?? summary.activeProfileIds[0]
    if (!profileId) {
      set({ workspaces: [], terminals: [], loadStatus: 'empty', loadError: null })
      return
    }

    await get().loadProfileWorkspace(profileId)
  },

  loadProfileWorkspace: async (profileId) => {
    const channels = useConnectionStore.getState().channels
    if (!channels) {
      set({ loadStatus: 'no-channel', loadError: null })
      return
    }

    await loadProfileSummary(channels, ({ profiles, activeProfileIds }) => {
      set({ profiles, activeProfileIds })
    })

    try {
      const snapshot = await channels.profile.loadSnapshot(profileId)
      const state = stateFromProfileSnapshot(snapshot)
      if (!state) {
        set({ loadStatus: 'parse-error', loadError: `Invalid profile snapshot: ${profileId}` })
        return
      }
      get().applyState(state)
    } catch (e) {
      set({ loadStatus: 'rpc-error', loadError: String(e) })
    }
  },

  applySnapshot: (raw: string) => {
    try {
      const state: AppState = JSON.parse(raw)
      get().applyState(state)
    } catch (e) {
      set({ loadStatus: 'parse-error', loadError: String(e) })
      console.warn('[WorkspaceStore] Failed to parse workspace data:', e)
    }
  },

  applyReload: (payload: unknown) => {
    if (typeof payload === 'string') {
      get().applySnapshot(payload)
      return
    }

    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      const snapshot = record.snapshot ?? record.data ?? record.workspace
      if (typeof snapshot === 'string') {
        get().applySnapshot(snapshot)
        return
      }
      if (Array.isArray(record.workspaces) || Array.isArray(record.terminals)) {
        get().applyState(record as unknown as AppState)
        return
      }
    }

    set({
      loadStatus: 'parse-error',
      loadError: 'Invalid workspace reload payload',
    })
  },

  applyState: (state: AppState) => {
    const workspaces = state.workspaces || []
    const terminals = (state.terminals || []).map(t => ({
      ...t,
      scrollbackBuffer: Array.isArray(t.scrollbackBuffer) ? t.scrollbackBuffer.slice(-500) : [],
    }))
    const activeWorkspaceId = state.activeWorkspaceId &&
      workspaces.some(w => w.id === state.activeWorkspaceId)
      ? state.activeWorkspaceId
      : workspaces[0]?.id ?? null
    const activeTerminalExists = state.activeTerminalId
      ? terminals.some(t => t.id === state.activeTerminalId)
      : false
    const firstTerminalInWorkspace = activeWorkspaceId
      ? terminals.find(t => t.workspaceId === activeWorkspaceId)
      : terminals[0]
    set({
      workspaces,
      activeWorkspaceId,
      terminals,
      activeTerminalId: activeTerminalExists ? state.activeTerminalId : firstTerminalInWorkspace?.id ?? null,
      loadStatus: workspaces.length > 0 ? 'ok' : 'empty',
      loadError: null,
    })
  },

  applyProfileChanged: (payload: unknown) => {
    const summary = profileSummaryFromPayload(payload)
    if (!summary) return
    set(summary)
  },

  switchWorkspace: (id: string) => {
    const { workspaces, terminals } = get()
    if (!workspaces.find(w => w.id === id)) return

    // Auto-select first terminal in the new workspace
    const workspaceTerminals = terminals.filter(t => t.workspaceId === id)
    const firstTerminal = workspaceTerminals[0]

    set({
      activeWorkspaceId: id,
      activeTerminalId: firstTerminal?.id ?? null,
    })
  },

  setActiveTerminal: (id: string) => {
    set({ activeTerminalId: id })
  },

  requestAddSession: async (workspaceId, agentPreset) => {
    const channels = useConnectionStore.getState().channels
    if (!channels) throw new Error('Not connected to remote server')

    const { workspaces, terminals, activeWorkspaceId, activeTerminalId } = get()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    let terminal = createTerminalForWorkspace(workspace, agentPreset)
    if (isWorktreePreset(agentPreset)) {
      const result = await channels.worktree.create(terminal.id, workspace.folderPath, false)
      const worktree = normalizeWorktreeResult(result)
      if (!worktree.success || !worktree.worktreePath) {
        throw new Error(worktree.error || 'Host failed to create worktree')
      }
      terminal = {
        ...terminal,
        cwd: worktree.worktreePath,
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        title: agentPreset === 'codex-agent-worktree'
          ? 'Codex Agent (worktree)'
          : 'Claude Agent (worktree)',
      }
    }

    const nextState: AppState = {
      workspaces,
      terminals: [...terminals, terminal],
      activeWorkspaceId: workspaceId,
      activeTerminalId: terminal.id,
      focusedTerminalId: terminal.id,
    }
    const previousState: AppState = {
      workspaces,
      terminals,
      activeWorkspaceId,
      activeTerminalId,
      focusedTerminalId: activeTerminalId,
    }

    get().applyState(nextState)

    try {
      const saved = await channels.workspace.save(JSON.stringify(nextState))
      if (!saved) throw new Error('Host rejected workspace save')
    } catch (e) {
      get().applyState(previousState)
      if (terminal.worktreePath) {
        await ignoreMissingRuntime(() => channels.worktree.remove(terminal.id, true))
      }
      throw e
    }

    return terminal
  },

  requestCloseSession: async (terminalId) => {
    const channels = useConnectionStore.getState().channels
    if (!channels) throw new Error('Not connected to remote server')

    const { workspaces, terminals, activeWorkspaceId, activeTerminalId } = get()
    const terminal = terminals.find(t => t.id === terminalId)
    if (!terminal) return

    if (terminal.agentPreset && SDK_AGENT_PRESETS.has(terminal.agentPreset)) {
      await ignoreMissingRuntime(() => channels.claude.stopSession(terminalId))
    } else {
      await ignoreMissingRuntime(() => channels.pty.kill(terminalId))
    }

    const remaining = terminals.filter(t => t.id !== terminalId)
    const fallback = restoredTerminalForWorkspace(
      terminal.workspaceId || activeWorkspaceId,
      remaining,
    )
    const nextActiveTerminalId = activeTerminalId === terminalId
      ? fallback?.id ?? null
      : activeTerminalId
    const nextState: AppState = {
      workspaces,
      terminals: remaining,
      activeWorkspaceId,
      activeTerminalId: nextActiveTerminalId,
      focusedTerminalId: nextActiveTerminalId,
    }

    const saved = await channels.workspace.save(JSON.stringify(nextState))
    if (!saved) throw new Error('Host rejected workspace save')
    await get().load()
  },

  getWorkspaceTerminals: (workspaceId: string) => {
    return get().terminals.filter(t => t.workspaceId === workspaceId)
  },

  getActiveWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get()
    return workspaces.find(w => w.id === activeWorkspaceId)
  },

  getActiveTerminal: () => {
    const { terminals, activeTerminalId } = get()
    return terminals.find(t => t.id === activeTerminalId)
  },
}))

function createTerminalForWorkspace(workspace: Workspace, agentPreset?: AgentPresetId): TerminalInstance {
  const normalizedPreset = agentPreset && agentPreset !== 'none' ? agentPreset : undefined
  const preset = normalizedPreset ? getAgentPreset(normalizedPreset) : null
  return {
    id: generateSessionId(),
    workspaceId: workspace.id,
    type: 'terminal',
    agentPreset: normalizedPreset,
    title: preset ? preset.name : 'New Terminal',
    cwd: workspace.folderPath,
    scrollbackBuffer: [],
    lastActivityTime: Date.now(),
    agentParams: normalizeAgentParams(normalizedPreset),
  }
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeAgentParams(agentPreset?: AgentPresetId): TerminalInstance['agentParams'] {
  if (agentPreset === 'codex-agent' || agentPreset === 'codex-agent-worktree') {
    return {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      effortLevel: 'high',
    }
  }
  return undefined
}

function isWorktreePreset(agentPreset?: AgentPresetId): boolean {
  return agentPreset === 'claude-code-worktree' || agentPreset === 'codex-agent-worktree'
}

function normalizeWorktreeResult(value: unknown): {
  success: boolean
  worktreePath?: string
  branchName?: string
  error?: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, error: 'Invalid worktree response' }
  }
  const record = value as Record<string, unknown>
  return {
    success: record.success === true,
    worktreePath: typeof record.worktreePath === 'string' ? record.worktreePath : undefined,
    branchName: typeof record.branchName === 'string' ? record.branchName : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}

function restoredTerminalForWorkspace(
  workspaceId: string | null | undefined,
  terminals: TerminalInstance[],
): TerminalInstance | undefined {
  return workspaceId
    ? terminals.find(t => t.workspaceId === workspaceId) ?? terminals[0]
    : terminals[0]
}

async function ignoreMissingRuntime(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch (e) {
    const message = String(e)
    if (
      /not found/i.test(message) ||
      /not exist/i.test(message) ||
      /no such/i.test(message) ||
      /not running/i.test(message) ||
      /already stopped/i.test(message)
    ) {
      return
    }
    throw e
  }
}

async function loadFromActiveProfileSnapshot(
  channels: NonNullable<ReturnType<typeof useConnectionStore.getState>['channels']>,
  applyState: (state: AppState) => void,
): Promise<boolean> {
  try {
    const list = await channels.profile.list()
    const profiles = normalizeProfiles(list.profiles)
    const profilesById = new Map(profiles.map((profile: ProfileEntry) => [profile.id, profile]))
    const activeIds = Array.isArray(list.activeProfileIds)
      ? list.activeProfileIds.map(id => String(id)).filter(Boolean)
      : list.activeProfileId ? [String(list.activeProfileId)] : []
    const activeLocalIds = activeIds.filter(id => profilesById.get(id)?.type !== 'remote')
    const fallbackIds = profiles
      .filter((profile: ProfileEntry) => profile.type !== 'remote')
      .map(profile => profile.id)
    const ids = [...new Set([...activeLocalIds, ...fallbackIds])]

    for (const id of ids) {
      const snapshot = await channels.profile.loadSnapshot(id)
      const state = stateFromProfileSnapshot(snapshot)
      if (state && state.workspaces.length > 0) {
        applyState(state)
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

async function loadProfileSummary(
  channels: NonNullable<ReturnType<typeof useConnectionStore.getState>['channels']>,
  apply: (summary: { profiles: ProfileEntry[]; activeProfileIds: string[] }) => void,
): Promise<void> {
  try {
    const list = await channels.profile.list()
    const summary = profileSummaryFromPayload(list)
    apply(summary ?? { profiles: [], activeProfileIds: [] })
  } catch {
    apply({ profiles: [], activeProfileIds: [] })
  }
}

function profileSummaryFromPayload(payload: unknown): { profiles: ProfileEntry[]; activeProfileIds: string[] } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const profiles = normalizeProfiles(record.profiles)
  const activeProfileIds = Array.isArray(record.activeProfileIds)
    ? record.activeProfileIds.map(id => String(id)).filter(Boolean)
    : record.activeProfileId ? [String(record.activeProfileId)] : []
  return { profiles, activeProfileIds }
}

function normalizeProfiles(value: unknown): ProfileEntry[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(item => {
        const id = String(item.id ?? '')
        const type: ProfileEntry['type'] = item.type === 'remote' ? 'remote' : 'local'
        return {
          id,
          name: String(item.name ?? id),
          type,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : undefined,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : undefined,
        }
      })
      .filter(profile => profile.id)
    : []
}

function stateFromProfileSnapshot(snapshot: unknown): AppState | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = snapshot as Record<string, unknown>

  if (Array.isArray(value.workspaces) || Array.isArray(value.terminals)) {
    return {
      workspaces: normalizeWorkspaces(value.workspaces),
      activeWorkspaceId: typeof value.activeWorkspaceId === 'string' ? value.activeWorkspaceId : null,
      terminals: normalizeTerminals(value.terminals),
      activeTerminalId: typeof value.activeTerminalId === 'string' ? value.activeTerminalId : null,
      focusedTerminalId: typeof value.focusedTerminalId === 'string' ? value.focusedTerminalId : null,
    }
  }

  if (!Array.isArray(value.windows)) return null
  const windows = value.windows.filter((win): win is Record<string, unknown> =>
    !!win && typeof win === 'object',
  )
  const preferred = windows.find(win =>
    (typeof win.activeWorkspaceId === 'string' && normalizeWorkspaces(win.workspaces).length > 0) ||
    normalizeTerminals(win.terminals).length > 0,
  ) ?? windows[0]

  const workspacesById = new Map<string, Workspace>()
  const terminalsById = new Map<string, TerminalInstance>()
  for (const win of windows) {
    for (const workspace of normalizeWorkspaces(win.workspaces)) {
      workspacesById.set(workspace.id, workspace)
    }
    for (const terminal of normalizeTerminals(win.terminals)) {
      terminalsById.set(terminal.id, terminal)
    }
  }

  const workspaces = [...workspacesById.values()]
  const terminals = [...terminalsById.values()]
  return {
    workspaces,
    activeWorkspaceId: typeof preferred?.activeWorkspaceId === 'string'
      ? preferred.activeWorkspaceId
      : workspaces[0]?.id ?? null,
    terminals,
    activeTerminalId: typeof preferred?.activeTerminalId === 'string'
      ? preferred.activeTerminalId
      : terminals[0]?.id ?? null,
    focusedTerminalId: typeof preferred?.focusedTerminalId === 'string'
      ? preferred.focusedTerminalId
      : null,
  }
}

function normalizeWorkspaces(value: unknown): Workspace[] {
  return Array.isArray(value) ? value.filter(isWorkspaceLike) : []
}

function normalizeTerminals(value: unknown): TerminalInstance[] {
  return Array.isArray(value) ? value.filter(isTerminalLike) : []
}

function isWorkspaceLike(value: unknown): value is Workspace {
  return !!value &&
    typeof value === 'object' &&
    typeof (value as Workspace).id === 'string' &&
    typeof (value as Workspace).folderPath === 'string'
}

function isTerminalLike(value: unknown): value is TerminalInstance {
  return !!value &&
    typeof value === 'object' &&
    typeof (value as TerminalInstance).id === 'string' &&
    typeof (value as TerminalInstance).workspaceId === 'string'
}
