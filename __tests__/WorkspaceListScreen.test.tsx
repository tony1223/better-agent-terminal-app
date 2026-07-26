import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { WorkspaceListScreen } from '../src/screens/WorkspaceListScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'

const mockSetOptions = jest.fn()

jest.useFakeTimers()

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    navigate: jest.fn(),
    getParent: jest.fn(),
    setOptions: mockSetOptions,
  }),
}))

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

jest.mock('../src/stores/connection-store', () => ({
  useConnectionStore: jest.fn(),
}))

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
