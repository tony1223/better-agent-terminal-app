import { recentWorkspaceShortcuts, useWorkspaceShortcutsStore } from '../src/stores/workspace-shortcuts-store'
import { switchRecentsScope } from '../src/stores/recents-store'

const workspace = { id: 'shared', name: 'Project', folderPath: '/project', createdAt: 0 }

beforeEach(() => useWorkspaceShortcutsStore.setState({ servers: {} }))

test('shortcuts survive profile changes, distinguish matching IDs, and stay on their server', () => {
  const { touch } = useWorkspaceShortcutsStore.getState()
  touch('server-a', 'profile-a', 'A', workspace)
  touch('server-a', 'profile-b', 'B', workspace)
  touch('server-b', 'profile-a', 'A', workspace)
  switchRecentsScope('server-a/profile-c')
  const { servers } = useWorkspaceShortcutsStore.getState()
  expect(servers['server-a'].map(entry => entry.profileId)).toEqual(['profile-b', 'profile-a'])
  expect(servers['server-b']).toHaveLength(1)
  touch('server-a', 'profile-a', 'Renamed', { ...workspace, alias: 'New name' })
  expect(useWorkspaceShortcutsStore.getState().servers['server-a']).toHaveLength(2)
  expect(useWorkspaceShortcutsStore.getState().servers['server-a'][0].name).toBe('New name')
})

test('top three use recency and remove deleted profiles and known deleted workspaces', () => {
  const entries = [1, 2, 3, 4, 5].map(i => ({ profileId: `p${i}`, profileName: `${i}`, workspaceId: 'shared', name: 'Project', folderPath: '/project', lastOpenedAt: i }))
  expect(recentWorkspaceShortcuts(entries, ['p1', 'p2', 'p3', 'p4', 'p5'], 'p5', [workspace], true).map(e => e.profileId)).toEqual(['p5', 'p4', 'p3'])
  expect(recentWorkspaceShortcuts(entries, ['p1', 'p2', 'p3', 'p5'], 'p5', [], true).map(e => e.profileId)).toEqual(['p3', 'p2', 'p1'])
  expect(recentWorkspaceShortcuts(entries, ['p5'], 'p5', [], false)).toHaveLength(1)
  expect(entries[0].profileId).toBe('p1')
})
