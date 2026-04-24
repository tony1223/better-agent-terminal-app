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

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  terminals: TerminalInstance[]
  activeTerminalId: string | null

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

  load: async () => {
    const channels = useConnectionStore.getState().channels
    if (!channels) return

    const raw = await channels.workspace.load()
    if (!raw) return

    try {
      const state: AppState = JSON.parse(raw)
      set({
        workspaces: state.workspaces || [],
        activeWorkspaceId: state.activeWorkspaceId,
        terminals: (state.terminals || []).map(t => ({
          ...t,
          scrollbackBuffer: [], // Don't load scrollback on mobile
        })),
        activeTerminalId: state.activeTerminalId,
      })
    } catch (e) {
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
