import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import { SessionContextBar } from '../src/components/session/SessionContextBar'
import { WorkspaceBrowser } from '../src/components/workspace/WorkspaceBrowser'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useWorkspaceNavigationStore } from '../src/stores/workspace-navigation-store'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => ({ navigate: mockNavigate }) }),
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
jest.mock('../src/components/workspace/WorkspaceBrowser', () => ({
  WorkspaceBrowser: () => null,
}))
const entry = {
  profileId: 'bat',
  profileName: 'BAT',
  workspaceId: 'w2',
  name: 'App',
  folderPath: '/app',
}
let renderer: Renderer.ReactTestRenderer
beforeEach(() => {
  mockNavigate.mockClear()
  useWorkspaceStore.setState({
    profiles: [
      { id: 'bat', name: 'BAT', type: 'local', createdAt: 0, updatedAt: 0 },
    ],
    workspaces: [
      { id: 'w1', name: 'Host', folderPath: '/host', createdAt: 0 },
      { id: 'w2', name: 'App', folderPath: '/app', createdAt: 0 },
    ],
    terminals: [],
    activeLocalProfileId: 'bat',
    activeWorkspaceId: 'w1',
  })
  useWorkspaceNavigationStore.setState({ pending: null, error: null })
  act(() => {
    renderer = Renderer.create(<SessionContextBar workspaceId="w1" />)
  })
})
afterEach(() => {
  act(() => renderer.unmount())
  jest.restoreAllMocks()
})

const openSwitcher = () =>
  act(() =>
    renderer.root
      .findAllByType(TouchableOpacity)
      .find(node => node.props.testID === 'session-workspace-switcher')!
      .props.onPress(),
  )

test('workspace header opens a shared switcher; same-profile selection opens the work pool, not a session', () => {
  openSwitcher()
  const browser = renderer.root.findByType(WorkspaceBrowser)
  act(() => browser.props.onOpen(entry))
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w2')
  expect(mockNavigate).toHaveBeenCalledWith('Workspaces', {
    screen: 'WorkspaceDetail',
    params: { workspaceId: 'w2' },
  })
  expect(renderer.root.findAllByType(WorkspaceBrowser)).toHaveLength(0)
})

test('cross-profile selection records its destination before showing the overview that consumes it', async () => {
  const open = jest
    .spyOn(useWorkspaceNavigationStore.getState(), 'open')
    .mockImplementation(async () => {
      expect(mockNavigate).not.toHaveBeenCalled()
    })
  openSwitcher()
  await act(async () => {
    await renderer.root
      .findByType(WorkspaceBrowser)
      .props.onOpen({ ...entry, profileId: 'ap01' })
  })
  expect(open).toHaveBeenCalledWith({ ...entry, profileId: 'ap01' })
  expect(mockNavigate).toHaveBeenCalledWith('Workspaces', {
    screen: 'WorkspaceList',
  })
})

test('explicit profile opening goes to its overview without selecting a workspace or session', async () => {
  const open = jest
    .spyOn(useWorkspaceNavigationStore.getState(), 'open')
    .mockResolvedValue(undefined)
  openSwitcher()
  await act(async () => {
    await renderer.root.findByType(WorkspaceBrowser).props.onOpenProfile('ap01')
  })
  expect(open).toHaveBeenCalledWith({ profileId: 'ap01', workspaceId: null })
  expect(mockNavigate).toHaveBeenCalledWith('Workspaces', {
    screen: 'WorkspaceList',
  })
  expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w1')
})
