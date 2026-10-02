import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'
import type { ProfileEntry, Workspace } from '@/types'
import type { WorkspaceShortcut } from './workspace-shortcuts-store'

export type WorkspaceEntry = Pick<
  WorkspaceShortcut,
  'profileId' | 'profileName' | 'workspaceId' | 'name' | 'folderPath'
>
export const workspaceEntryKey = (
  entry: Pick<WorkspaceEntry, 'profileId' | 'workspaceId'>,
) => JSON.stringify([entry.profileId, entry.workspaceId])

interface BrowserPreferences {
  catalog: Record<string, WorkspaceEntry[]>
  loadedProfiles: string[]
  pins: string[]
  mode: 'pinned' | 'all'
  profileId: string | null
  query: string
}
const storage = createMMKV({ id: 'bat-workspace-browser' })
const KEY = 'server-browser-v1'
export const emptyBrowser: BrowserPreferences = {
  catalog: {},
  loadedProfiles: [],
  pins: [],
  mode: 'all',
  profileId: null,
  query: '',
}

function validKey(key: unknown): key is string {
  if (typeof key !== 'string') return false
  try {
    const pair = JSON.parse(key)
    return (
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every(value => typeof value === 'string')
    )
  } catch {
    return false
  }
}

function read(): Record<string, BrowserPreferences> {
  try {
    const saved = JSON.parse(storage.getString(KEY) ?? '{}')
    const servers: Record<string, BrowserPreferences> = {}
    for (const [server, value] of Object.entries(saved)) {
      const item = value as Partial<BrowserPreferences> | null
      if (
        !item ||
        !Array.isArray(item.pins) ||
        !item.catalog ||
        typeof item.catalog !== 'object'
      )
        continue
      const catalog: BrowserPreferences['catalog'] = {}
      for (const [profileId, entries] of Object.entries(item.catalog)) {
        if (!Array.isArray(entries)) continue
        catalog[profileId] = entries
          .filter(
            entry =>
              entry &&
              entry.profileId === profileId &&
              (
                [
                  'profileId',
                  'profileName',
                  'workspaceId',
                  'name',
                  'folderPath',
                ] as const
              ).every(key => typeof entry[key] === 'string'),
          )
          .map(
            ({
              profileId: id,
              profileName,
              workspaceId,
              name,
              folderPath,
            }) => ({
              profileId: id,
              profileName,
              workspaceId,
              name,
              folderPath,
            }),
          )
      }
      servers[server] = {
        ...emptyBrowser,
        catalog,
        loadedProfiles: Array.isArray(item.loadedProfiles)
          ? item.loadedProfiles.filter(id => typeof id === 'string')
          : [],
        pins: [...new Set(item.pins.filter(validKey))],
        mode: item.mode === 'pinned' ? 'pinned' : 'all',
      }
    }
    return servers
  } catch {
    return {}
  }
}

interface BrowserState {
  servers: Record<string, BrowserPreferences>
  remember: (
    server: string,
    profileId: string,
    profileName: string,
    workspaces: Workspace[],
  ) => void
  configure: (
    server: string,
    changes: Partial<Pick<BrowserPreferences, 'mode' | 'profileId' | 'query'>>,
  ) => void
  togglePin: (server: string, entry: WorkspaceEntry) => void
  movePin: (
    server: string,
    entry: WorkspaceEntry,
    direction: -1 | 1,
    visibleKeys?: string[],
  ) => void
}

export const useWorkspaceBrowserStore = create<BrowserState>(set => {
  const update = (
    server: string,
    transform: (previous: BrowserPreferences) => BrowserPreferences,
  ) =>
    set(state => {
      if (!server) return state
      const previous = state.servers[server] ?? emptyBrowser
      const next = transform(previous)
      if (JSON.stringify(previous) === JSON.stringify(next)) return state
      const servers = { ...state.servers, [server]: next }
      // Persist only workspace labels/paths and fixed ordering, never session data or credentials.
      if (
        next.catalog !== previous.catalog ||
        next.loadedProfiles !== previous.loadedProfiles ||
        next.pins !== previous.pins ||
        next.mode !== previous.mode
      ) {
        const saved = Object.fromEntries(
          Object.entries(servers).map(([key, value]) => [
            key,
            { ...value, query: '', profileId: null },
          ]),
        )
        storage.set(KEY, JSON.stringify(saved))
      }
      return { servers }
    })
  return {
    servers: read(),
    remember: (server, profileId, profileName, workspaces) =>
      update(server, previous => {
        const entries = workspaces.map(workspace => ({
          profileId,
          profileName,
          workspaceId: workspace.id,
          name: workspace.alias || workspace.name,
          folderPath: workspace.folderPath,
        }))
        const valid = new Set(entries.map(workspaceEntryKey))
        return {
          ...previous,
          catalog: { ...previous.catalog, [profileId]: entries },
          loadedProfiles: previous.loadedProfiles.includes(profileId)
            ? previous.loadedProfiles
            : [...previous.loadedProfiles, profileId],
          pins: previous.pins.filter(
            key =>
              validKey(key) &&
              (JSON.parse(key)[0] !== profileId || valid.has(key)),
          ),
        }
      }),
    configure: (server, changes) =>
      update(server, previous => ({ ...previous, ...changes })),
    togglePin: (server, entry) =>
      update(server, previous => {
        const key = workspaceEntryKey(entry)
        const pinned = previous.pins.includes(key)
        const catalog = previous.catalog[entry.profileId] ?? []
        const { profileId, profileName, workspaceId, name, folderPath } = entry
        return {
          ...previous,
          catalog: {
            ...previous.catalog,
            [entry.profileId]: catalog.some(
              item => workspaceEntryKey(item) === key,
            )
              ? catalog
              : [
                  ...catalog,
                  { profileId, profileName, workspaceId, name, folderPath },
                ],
          },
          pins: pinned
            ? previous.pins.filter(pin => pin !== key)
            : [...previous.pins, key],
        }
      }),
    movePin: (server, entry, direction, visibleKeys) =>
      update(server, previous => {
        const pins = [...previous.pins]
        const visible = visibleKeys
          ? pins.filter(key => visibleKeys.includes(key))
          : pins
        const visibleIndex = visible.indexOf(workspaceEntryKey(entry))
        const neighbor = visible[visibleIndex + direction]
        if (visibleIndex < 0 || !neighbor) return previous
        const index = pins.indexOf(workspaceEntryKey(entry))
        const target = pins.indexOf(neighbor)
        ;[pins[index], pins[target]] = [pins[target], pins[index]]
        return { ...previous, pins }
      }),
  }
})

/** Current validated snapshots override caches, including an empty snapshot. */
export function browserEntries(
  preferences: BrowserPreferences,
  shortcuts: WorkspaceShortcut[],
  profiles: ProfileEntry[],
  currentProfileId: string | null,
  workspaces: Workspace[],
  snapshotReady: boolean,
): WorkspaceEntry[] {
  const entries = new Map<string, WorkspaceEntry>()
  const knownProfiles = new Map(
    profiles.map(profile => [profile.id, profile.name || profile.id]),
  )
  // A complete cached snapshot (even empty) also overrides legacy recents;
  // otherwise deleted workspaces would reappear when leaving that profile.
  const fallback = shortcuts.filter(
    entry => !preferences.loadedProfiles.includes(entry.profileId),
  )
  for (const entry of [
    ...fallback,
    ...Object.values(preferences.catalog).flat(),
  ]) {
    if (knownProfiles.has(entry.profileId))
      entries.set(workspaceEntryKey(entry), {
        ...entry,
        profileName: knownProfiles.get(entry.profileId)!,
      })
  }
  if (currentProfileId && snapshotReady) {
    for (const [key, entry] of entries)
      if (entry.profileId === currentProfileId) entries.delete(key)
    for (const workspace of workspaces) {
      const entry = {
        profileId: currentProfileId,
        profileName: knownProfiles.get(currentProfileId) ?? currentProfileId,
        workspaceId: workspace.id,
        name: workspace.alias || workspace.name,
        folderPath: workspace.folderPath,
      }
      entries.set(workspaceEntryKey(entry), entry)
    }
  }
  return [...entries.values()]
}

export function filterBrowserEntries(
  entries: WorkspaceEntry[],
  preferences: BrowserPreferences,
): WorkspaceEntry[] {
  const needle = preferences.query.trim().toLocaleLowerCase()
  const filtered = entries.filter(
    entry =>
      (!preferences.profileId || entry.profileId === preferences.profileId) &&
      (!needle ||
        [entry.name, entry.profileName, entry.folderPath]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle)),
  )
  const pinned = preferences.pins.flatMap(key =>
    filtered.filter(entry => workspaceEntryKey(entry) === key),
  )
  return preferences.mode === 'pinned'
    ? pinned
    : [
        ...pinned,
        ...filtered
          .filter(entry => !preferences.pins.includes(workspaceEntryKey(entry)))
          .sort(
            (a, b) =>
              a.profileName.localeCompare(b.profileName) ||
              a.name.localeCompare(b.name),
          ),
      ]
}
