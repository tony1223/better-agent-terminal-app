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
} from '@/types'
import { useConnectionStore } from './connection-store'

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
  applySnapshot: (raw: string) => void
  applyState: (state: AppState) => void
  switchWorkspace: (id: string) => void
  setActiveTerminal: (id: string) => void

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

  applySnapshot: (raw: string) => {
    try {
      const state: AppState = JSON.parse(raw)
      get().applyState(state)
    } catch (e) {
      set({ loadStatus: 'parse-error', loadError: String(e) })
      console.warn('[WorkspaceStore] Failed to parse workspace data:', e)
    }
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

async function loadFromActiveProfileSnapshot(
  channels: NonNullable<ReturnType<typeof useConnectionStore.getState>['channels']>,
  applyState: (state: AppState) => void,
): Promise<boolean> {
  try {
    const list = await channels.profile.list()
    const activeIds = Array.isArray(list.activeProfileIds)
      ? list.activeProfileIds
      : list.activeProfileId ? [list.activeProfileId] : []
    const fallbackIds = (list.profiles || [])
      .filter((profile: ProfileEntry) => profile.type !== 'remote')
      .map(profile => profile.id)
    const ids = [...new Set([...activeIds, ...fallbackIds])]

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
    const activeProfileIds = Array.isArray(list.activeProfileIds)
      ? list.activeProfileIds
      : list.activeProfileId ? [list.activeProfileId] : []
    const profiles = Array.isArray(list.profiles)
      ? list.profiles
      : []
    apply({ profiles, activeProfileIds })
  } catch {
    apply({ profiles: [], activeProfileIds: [] })
  }
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
