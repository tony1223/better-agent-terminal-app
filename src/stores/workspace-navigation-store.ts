import { create } from 'zustand'
import { useConnectionStore, workspaceShortcutServerKey } from './connection-store'
import { useWorkspaceStore } from './workspace-store'
import type { WorkspaceShortcut } from './workspace-shortcuts-store'

interface WorkspaceDestination {
  id: number
  client: ReturnType<typeof useConnectionStore.getState>['client']
  serverKey: string
  profileId: string
  workspaceId: string
  ready: boolean
  viewKey: string | null
}

interface WorkspaceNavigationState {
  pending: WorkspaceDestination | null
  error: string | null
  open: (shortcut: WorkspaceShortcut) => Promise<void>
  finish: (id: number, error?: string) => void
}

let requestId = 0

/** An open intent outlives the old navigation stack during a profile switch.
 * The newly mounted list consumes it only after that profile's snapshot loads.
 */
export const useWorkspaceNavigationStore = create<WorkspaceNavigationState>((set, get) => ({
  pending: null,
  error: null,
  open: async ({ profileId, workspaceId }) => {
    if (get().pending) return
    const connection = useConnectionStore.getState()
    const serverKey = workspaceShortcutServerKey(connection)
    if (!connection.channels || !serverKey) return
    const id = ++requestId
    const client = connection.client
    set({ pending: { id, client, serverKey, profileId, workspaceId, ready: false, viewKey: null }, error: null })
    const isCurrent = () => get().pending?.id === id
    try {
      await useWorkspaceStore.getState().loadProfileWorkspace(profileId)
      if (!isCurrent()) return
      const state = useConnectionStore.getState()
      if (state.client !== client || workspaceShortcutServerKey(state) !== serverKey ||
        useWorkspaceStore.getState().activeLocalProfileId !== profileId) {
        get().finish(id)
        return
      }
      set({ pending: { ...get().pending!, ready: true, viewKey: state.profileViewKey ?? null } })
    } catch (error) {
      if (isCurrent()) {
        const state = useConnectionStore.getState()
        const sameServer = state.client === client && workspaceShortcutServerKey(state) === serverKey
        get().finish(id, sameServer ? String(error) : undefined)
      }
    }
  },
  finish: (id, error) => {
    if (get().pending?.id === id) set({ pending: null, error: error ?? null })
  },
}))
