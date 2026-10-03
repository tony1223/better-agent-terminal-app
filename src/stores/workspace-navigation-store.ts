import { create } from 'zustand'
import { useConnectionStore, workspaceShortcutServerKey } from './connection-store'
import { useWorkspaceStore } from './workspace-store'

interface WorkspaceDestination {
  id: number
  client: ReturnType<typeof useConnectionStore.getState>['client']
  serverKey: string
  profileId: string
  workspaceId: string | null
  ready: boolean
  navigating: boolean
  viewKey: string | null
  label: string
}

interface WorkspaceNavigationState {
  pending: WorkspaceDestination | null
  error: string | null
  open: (destination: { profileId: string; workspaceId: string | null; name?: string; profileName?: string }) => Promise<void>
  beginNavigation: (id: number) => void
  arrive: (id: number) => void
  finish: (id: number, error?: string) => void
}

let requestId = 0

/** An open intent outlives the old navigation stack during a profile switch.
 * The newly mounted list consumes it only after that profile's snapshot loads.
 */
export const useWorkspaceNavigationStore = create<WorkspaceNavigationState>((set, get) => ({
  pending: null,
  error: null,
  open: async ({ profileId, workspaceId, name, profileName }) => {
    if (get().pending) return
    const connection = useConnectionStore.getState()
    const serverKey = workspaceShortcutServerKey(connection)
    if (!connection.channels || !serverKey) return
    const id = ++requestId
    const client = connection.client
    const label = [profileName ?? useWorkspaceStore.getState().profiles.find(p => p.id === profileId)?.name, name]
      .filter(Boolean).join(' / ')
    set({ pending: { id, client, serverKey, profileId, workspaceId, ready: false, navigating: false, viewKey: null, label }, error: null })
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
  beginNavigation: id => {
    const pending = get().pending
    if (pending?.id === id && pending.ready) set({ pending: { ...pending, navigating: true } })
  },
  // Only the destination screen's layout can uncover the new navigation stack.
  arrive: id => {
    const pending = get().pending
    const connection = useConnectionStore.getState()
    const workspace = useWorkspaceStore.getState()
    if (pending?.id !== id || !pending.navigating ||
      pending.client !== connection.client || pending.serverKey !== workspaceShortcutServerKey(connection) ||
      pending.viewKey !== (connection.profileViewKey ?? null) ||
      pending.profileId !== workspace.activeLocalProfileId ||
      !workspace.workspaces.some(w => w.id === pending.workspaceId)) return
    get().finish(id)
  },
  finish: (id, error) => {
    if (get().pending?.id === id) set({ pending: null, error: error ?? null })
  },
}))
