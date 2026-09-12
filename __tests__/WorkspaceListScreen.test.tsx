import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { WorkspaceListScreen } from '../src/screens/WorkspaceListScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useWorkspaceShortcutsStore } from '../src/stores/workspace-shortcuts-store'

const mockSetOptions = jest.fn()
const mockNavigate = jest.fn()

jest.useFakeTimers()

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: jest.fn(),
    setOptions: mockSetOptions,
  }),
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

jest.mock('../src/stores/connection-store', () => ({
  ...jest.requireActual('../src/stores/connection-store'),
  useConnectionStore: jest.fn(),
}))

beforeEach(() => {
  mockNavigate.mockClear()
  useWorkspaceShortcutsStore.setState({ servers: {} })
})

jest.mock('../src/stores/workspace-store', () => ({
  useWorkspaceStore: jest.fn(),
}))

test('selecting a profile changes only the mobile view', async () => {
  const activate = jest.fn()
  const deactivate = jest.fn()
  const loadProfileWorkspace = jest.fn().mockResolvedValue(undefined)
  const disconnect = jest.fn()
  const channels = { profile: { activate, deactivate } }
  const connectionStoreMock = useConnectionStore as unknown as jest.Mock
  const workspaceStoreMock = useWorkspaceStore as unknown as jest.Mock

  connectionStoreMock.mockImplementation(selector => selector({
    channels,
    disconnect,
  }))
  workspaceStoreMock.mockReturnValue({
    workspaces: [],
    terminals: [],
    activeWorkspaceId: null,
    loadStatus: 'empty',
    loadError: null,
    load: jest.fn().mockResolvedValue(undefined),
    loadProfileWorkspace,
    switchWorkspace: jest.fn(),
    profiles: [
      {
        id: 'default',
        name: 'Default',
        type: 'local',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'lineage',
        name: 'lineage',
        type: 'local',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeProfileIds: ['default'],
    activeLocalProfileId: 'default',
  })

  let renderer: ReactTestRenderer.ReactTestRenderer
  act(() => {
    renderer = ReactTestRenderer.create(<WorkspaceListScreen />)
  })

  const headerRight = mockSetOptions.mock.calls.at(-1)?.[0]?.headerRight
  expect(headerRight).toEqual(expect.any(Function))
  act(() => {
    headerRight().props.onPress()
  })

  const lineageRow = renderer!.root
    .findAllByType(TouchableOpacity)
    .find(row => row.findAllByType(Text).some(text => text.props.children === 'lineage'))
  expect(lineageRow).toBeDefined()

  await act(async () => {
    await lineageRow!.props.onPress()
  })

  expect(loadProfileWorkspace).toHaveBeenCalledTimes(1)
  expect(loadProfileWorkspace).toHaveBeenCalledWith('lineage')
  expect(activate).not.toHaveBeenCalled()
  expect(deactivate).not.toHaveBeenCalled()

  act(() => {
    renderer!.unmount()
  })
})

test.each(['success', 'failed', 'deleted', 'server-changed'])(
  'cross-profile shortcut waits for a validated snapshot: %s', async outcome => {
    const target = { id: 'same-id', name: 'Target', folderPath: '/target', createdAt: 0 }
    const connection = { host: 'host', port: 1, client: {}, channels: {}, disconnect: jest.fn() }
    let state: any = {
      workspaces: [{ ...target, name: 'Wrong profile', folderPath: '/wrong' }],
      terminals: [], activeWorkspaceId: 'same-id', activeLocalProfileId: 'first',
      profiles: [{ id: 'first', name: 'First', type: 'local' }, { id: 'second', name: 'Second', type: 'local' }],
      activeProfileIds: ['first', 'second'], loadStatus: 'ok', loadError: null,
      switchWorkspace: jest.fn(), load: jest.fn(),
    }
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    state.loadProfileWorkspace = jest.fn(async () => {
      await pending
      if (outcome === 'failed') throw new Error('offline')
      state = { ...state, activeLocalProfileId: 'second', workspaces: outcome === 'deleted' ? [] : [target], loadStatus: outcome === 'deleted' ? 'empty' : 'ok' }
      if (outcome === 'server-changed') connection.host = 'different-server'
    })
    Object.assign(useConnectionStore, { getState: () => connection })
    Object.assign(useWorkspaceStore, { getState: () => state })
    ;(useConnectionStore as unknown as jest.Mock).mockImplementation(selector => selector(connection))
    ;(useWorkspaceStore as unknown as jest.Mock).mockImplementation(() => state)
    useWorkspaceShortcutsStore.getState().touch('host:1', 'second', 'Second', target)
    let renderer!: ReactTestRenderer.ReactTestRenderer
    await act(async () => { renderer = ReactTestRenderer.create(<WorkspaceListScreen />) })
    const shortcut = renderer.root.findAllByType(TouchableOpacity).find(row => row.props.testID === 'workspace-shortcut-second-same-id')!
    let opening!: Promise<void>
    act(() => { opening = shortcut.props.onPress() })
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(state.loadProfileWorkspace).toHaveBeenCalledWith('second')
    await act(async () => { finish(); await opening })
    if (outcome === 'success') {
      expect(mockNavigate).toHaveBeenCalledWith('WorkspaceDetail', { workspaceId: 'same-id' })
      expect(state.switchWorkspace).toHaveBeenCalledWith('same-id')
    } else {
      expect(mockNavigate).not.toHaveBeenCalled()
    }
    if (outcome === 'deleted') expect(useWorkspaceShortcutsStore.getState().servers['host:1']).toEqual([])
    act(() => renderer.unmount())
  },
)
