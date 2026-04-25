/**
 * Workspace Store - manages workspaces and terminals
 * Data is loaded from BAT server via workspace:load channel
 */

import { create } from 'zustand'
import type {
  Workspace,
  TerminalInstance,
  AppState,
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
  loadStatus: WorkspaceLoadStatus
  loadError: string | null

  // Actions
  load: () => Promise<void>
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
  loadStatus: 'idle',
  loadError: null,

  load: async () => {
    const channels = useConnectionStore.getState().channels
    if (!channels) {
      set({ loadStatus: 'no-channel', loadError: null })
      return
    }

    let raw: string | null
    try {
      raw = await channels.workspace.load()
    } catch (e) {
      set({ loadStatus: 'rpc-error', loadError: String(e) })
      return
    }

    if (raw == null) {
      set({ workspaces: [], terminals: [], loadStatus: 'no-window', loadError: null })
      return
    }

    try {
      const state: AppState = JSON.parse(raw)
      const workspaces = state.workspaces || []
      set({
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId,
        terminals: (state.terminals || []).map(t => ({
          ...t,
          scrollbackBuffer: [], // Don't load scrollback on mobile
        })),
        activeTerminalId: state.activeTerminalId,
        loadStatus: workspaces.length > 0 ? 'ok' : 'empty',
        loadError: null,
      })
    } catch (e) {
      set({ loadStatus: 'parse-error', loadError: String(e) })
      console.warn('[WorkspaceStore] Failed to parse workspace data:', e)
    }
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
