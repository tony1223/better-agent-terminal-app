import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'
import type { Workspace } from '@/types'

const storage = createMMKV({ id: 'bat-workspace-shortcuts' })
const KEY = 'server-workspaces-v1'

export interface WorkspaceShortcut {
  profileId: string
  profileName: string
  workspaceId: string
  name: string
  folderPath: string
  lastOpenedAt: number
}

interface ShortcutsState {
  servers: Record<string, WorkspaceShortcut[]>
  touch: (serverKey: string, profileId: string, profileName: string, workspace: Workspace) => void
  forget: (serverKey: string, profileId: string, workspaceId: string) => void
}

function read(): ShortcutsState['servers'] {
  try {
    const parsed = JSON.parse(storage.getString(KEY) ?? '{}')
    const servers: ShortcutsState['servers'] = {}
    for (const [server, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue
      servers[server] = entries.filter(entry => entry &&
        typeof entry.profileId === 'string' && typeof entry.profileName === 'string' &&
        typeof entry.workspaceId === 'string' && typeof entry.name === 'string' &&
        typeof entry.folderPath === 'string' && Number.isFinite(entry.lastOpenedAt))
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 40)
    }
    return servers
  } catch { return {} }
}

export const useWorkspaceShortcutsStore = create<ShortcutsState>((set) => ({
  servers: read(),
  touch: (serverKey, profileId, profileName, workspace) => set(state => {
    if (!serverKey || !profileId) return state
    // Named fields only: shortcuts never persist sessions or profile credentials.
    const entry: WorkspaceShortcut = {
      profileId, profileName, workspaceId: workspace.id,
      name: workspace.alias || workspace.name, folderPath: workspace.folderPath,
      lastOpenedAt: Date.now(),
    }
    const remaining = (state.servers[serverKey] ?? []).filter(item =>
      item.profileId !== profileId || item.workspaceId !== workspace.id)
    const servers = { ...state.servers, [serverKey]: [entry, ...remaining].slice(0, 40) }
    storage.set(KEY, JSON.stringify(servers))
    return { servers }
  }),
  forget: (serverKey, profileId, workspaceId) => set(state => {
    const servers = { ...state.servers, [serverKey]: (state.servers[serverKey] ?? [])
      .filter(item => item.profileId !== profileId || item.workspaceId !== workspaceId) }
    storage.set(KEY, JSON.stringify(servers))
    return { servers }
  }),
}))

export function recentWorkspaceShortcuts(
  entries: WorkspaceShortcut[],
  profileIds: string[],
  currentProfileId: string | null,
  workspaces: Workspace[],
  currentSnapshotReady: boolean,
): WorkspaceShortcut[] {
  return entries
    .filter(item => profileIds.includes(item.profileId))
    .filter(item => !currentSnapshotReady || item.profileId !== currentProfileId || workspaces.some(w => w.id === item.workspaceId))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, 3)
}
