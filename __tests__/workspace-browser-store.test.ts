import {
  browserEntries,
  emptyBrowser,
  filterBrowserEntries,
  useWorkspaceBrowserStore,
  workspaceEntryKey,
} from '../src/stores/workspace-browser-store'
import type { ProfileEntry } from '../src/types'

const workspace = {
  id: 'shared',
  name: 'Project',
  folderPath: '/project',
  createdAt: 0,
}
const profiles = [
  { id: 'bat', name: 'BAT' },
  { id: 'ap01', name: 'AP01' },
] as ProfileEntry[]
beforeEach(() => useWorkspaceBrowserStore.setState({ servers: {} }))

test('loaded catalogs retain all visited profiles, distinguish identical IDs, and isolate servers', () => {
  const store = useWorkspaceBrowserStore.getState()
  store.remember('server-a', 'bat', 'BAT', [workspace])
  store.remember('server-a', 'ap01', 'AP01', [
    { ...workspace, name: 'Company' },
  ])
  store.remember('server-b', 'bat', 'BAT', [
    { ...workspace, name: 'Other server' },
  ])
  const a = useWorkspaceBrowserStore.getState().servers['server-a']
  const entries = browserEntries(a, [], profiles, 'ap01', [], false)
  expect(entries.map(entry => [entry.profileId, entry.name])).toEqual([
    ['bat', 'Project'],
    ['ap01', 'Company'],
  ])
  expect(new Set(entries.map(workspaceEntryKey)).size).toBe(2)
  expect(
    useWorkspaceBrowserStore.getState().servers['server-b'].catalog.bat[0].name,
  ).toBe('Other server')
})

test('pins keep fixed order across activity and catalog refreshes; manual reorder persists', () => {
  const store = useWorkspaceBrowserStore.getState()
  store.remember('server', 'bat', 'BAT', [workspace])
  store.remember('server', 'ap01', 'AP01', [workspace])
  const first =
    useWorkspaceBrowserStore.getState().servers.server.catalog.bat[0]
  const second =
    useWorkspaceBrowserStore.getState().servers.server.catalog.ap01[0]
  store.togglePin('server', first)
  store.togglePin('server', second)
  store.configure('server', { mode: 'pinned' })
  store.remember('server', 'ap01', 'AP01', [{ ...workspace, alias: 'Renamed' }])
  let preferences = useWorkspaceBrowserStore.getState().servers.server
  let entries = browserEntries(preferences, [], profiles, null, [], false)
  expect(
    filterBrowserEntries(entries, preferences).map(entry => entry.profileId),
  ).toEqual(['bat', 'ap01'])
  store.movePin('server', second, -1)
  preferences = useWorkspaceBrowserStore.getState().servers.server
  entries = browserEntries(preferences, [], profiles, null, [], false)
  expect(
    filterBrowserEntries(entries, preferences).map(entry => entry.profileId),
  ).toEqual(['ap01', 'bat'])
  store.movePin('server', second, -1) // Boundary is a no-op.
  expect(useWorkspaceBrowserStore.getState().servers.server.pins).toEqual(
    preferences.pins,
  )
  expect(filterBrowserEntries(entries, preferences)[0].name).toBe('Renamed')
  store.togglePin('server', second)
  expect(useWorkspaceBrowserStore.getState().servers.server.pins).toEqual([
    workspaceEntryKey(first),
  ])
})

test('search matches profile names and workspace names; profile filter is independent', () => {
  const store = useWorkspaceBrowserStore.getState()
  store.remember('server', 'bat', 'BAT', [workspace])
  store.remember('server', 'ap01', 'AP01', [
    { ...workspace, name: 'Company', folderPath: '/company' },
  ])
  const preferences = useWorkspaceBrowserStore.getState().servers.server
  const entries = browserEntries(preferences, [], profiles, null, [], false)
  expect(
    filterBrowserEntries(entries, { ...preferences, query: 'ap01' }).map(
      entry => entry.name,
    ),
  ).toEqual(['Company'])
  expect(
    filterBrowserEntries(entries, { ...preferences, query: 'project' }).map(
      entry => entry.profileId,
    ),
  ).toEqual(['bat'])
  expect(
    filterBrowserEntries(entries, {
      ...preferences,
      profileId: 'bat',
      query: 'ap01',
    }),
  ).toEqual([])
  expect(
    filterBrowserEntries(entries, { ...preferences, profileId: 'bat' }),
  ).toHaveLength(1)
  expect(preferences.profileId).toBeNull()
})

test('All keeps pins first in manual order and filtered moves skip hidden pins', () => {
  const store = useWorkspaceBrowserStore.getState()
  store.remember('server', 'bat', 'BAT', [workspace, { ...workspace, id: 'second', name: 'Second' }, { ...workspace, id: 'other', name: 'Aardvark' }])
  store.remember('server', 'ap01', 'AP01', [workspace])
  const catalog = useWorkspaceBrowserStore.getState().servers.server.catalog
  const [first, second, other] = catalog.bat
  const hidden = catalog.ap01[0]
  for (const entry of [first, hidden, second]) store.togglePin('server', entry)
  const visible = [workspaceEntryKey(first), workspaceEntryKey(second)]
  store.movePin('server', second, -1, visible)
  let preferences = useWorkspaceBrowserStore.getState().servers.server
  const entries = browserEntries(preferences, [], profiles, null, [], false)
  expect(filterBrowserEntries(entries, preferences)).toEqual([second, hidden, first, other])
  expect(filterBrowserEntries(entries, { ...preferences, profileId: 'bat' })).toEqual([second, first, other])
  store.movePin('server', second, -1, visible)
  expect(useWorkspaceBrowserStore.getState().servers.server.pins).toEqual(preferences.pins)
  store.remember('server', 'bat', 'BAT', [workspace, { ...workspace, id: 'second', name: 'Second' }, { ...workspace, id: 'other', name: 'Aardvark' }])
  preferences = useWorkspaceBrowserStore.getState().servers.server
  expect(preferences.pins).toEqual([workspaceEntryKey(second), workspaceEntryKey(hidden), workspaceEntryKey(first)])
  expect(useWorkspaceBrowserStore.getState().servers['different-host']).toBeUndefined()
})

test('validated empty snapshots remove deleted workspaces and pins, but in-flight snapshots do not', () => {
  const store = useWorkspaceBrowserStore.getState()
  store.remember('server', 'bat', 'BAT', [workspace])
  const entry =
    useWorkspaceBrowserStore.getState().servers.server.catalog.bat[0]
  store.togglePin('server', entry)
  const preferences = useWorkspaceBrowserStore.getState().servers.server
  expect(
    browserEntries(preferences, [], profiles, 'bat', [], false),
  ).toHaveLength(1)
  expect(browserEntries(preferences, [], profiles, 'bat', [], true)).toEqual([])
  store.remember('server', 'bat', 'BAT', [])
  expect(useWorkspaceBrowserStore.getState().servers.server.pins).toEqual([])
  expect(browserEntries(preferences, [], [], null, [], false)).toEqual([]) // Deleted profile.
})

test('old shortcuts seed the overview but fresh names and deletions override them', () => {
  const shortcut = {
    profileId: 'bat',
    profileName: 'Old',
    workspaceId: 'shared',
    name: 'Old',
    folderPath: '/old',
    lastOpenedAt: 1,
  }
  expect(
    browserEntries(emptyBrowser, [shortcut], profiles, null, [], false)[0]
      .profileName,
  ).toBe('BAT')
  expect(
    browserEntries(
      emptyBrowser,
      [shortcut],
      profiles,
      'bat',
      [workspace],
      true,
    )[0].name,
  ).toBe('Project')
  expect(
    browserEntries(emptyBrowser, [shortcut], profiles, 'bat', [], true),
  ).toEqual([])
  useWorkspaceBrowserStore.getState().remember('server', 'bat', 'BAT', [])
  const validatedEmpty = useWorkspaceBrowserStore.getState().servers.server
  expect(
    browserEntries(validatedEmpty, [shortcut], profiles, 'ap01', [], false),
  ).toEqual([])
})

test('stored workspace catalogs contain named metadata only, never sessions or profile secrets', () => {
  const store = useWorkspaceBrowserStore.getState()
  store.remember('server', 'bat', 'BAT', [
    {
      ...workspace,
      terminals: ['secret'],
      sshPassword: 'password',
    } as typeof workspace,
  ])
  const entry =
    useWorkspaceBrowserStore.getState().servers.server.catalog.bat[0]
  expect(Object.keys(entry).sort()).toEqual([
    'folderPath',
    'name',
    'profileId',
    'profileName',
    'workspaceId',
  ])
  expect(JSON.stringify(entry)).not.toMatch(/secret|password/)
})
