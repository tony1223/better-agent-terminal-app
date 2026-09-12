import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { WorkspaceListScreen } from '../src/screens/WorkspaceListScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useWorkspaceShortcutsStore } from '../src/stores/workspace-shortcuts-store'
import { useWorkspaceNavigationStore } from '../src/stores/workspace-navigation-store'

const mockSetOptions = jest.fn()
const mockNavigate = jest.fn()
let mockCurrentNavigate = mockNavigate

jest.useFakeTimers()

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    navigate: mockCurrentNavigate,
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
  mockCurrentNavigate = mockNavigate
  mockNavigate.mockClear()
  ;(useFocusEffect as jest.Mock).mockClear()
  useWorkspaceShortcutsStore.setState({ servers: {} })
  useWorkspaceNavigationStore.setState({ pending: null, error: null })
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

test.each(['before-load', 'after-load', 'superseded-load'])(
  'one shortcut tap survives the profile navigation remount: %s', async timing => {
    const target = { id: 'same-id', name: 'Target', folderPath: '/target', createdAt: 0 }
    const connection = { host: 'host', port: 1, client: {}, channels: {}, profileViewKey: 'first', disconnect: jest.fn() }
    let finish!: () => void
    const loading = new Promise<void>(resolve => { finish = resolve })
    const state: any = {
      workspaces: [{ ...target, name: 'Wrong profile' }], terminals: [], activeWorkspaceId: 'same-id',
      activeLocalProfileId: 'first', profiles: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
      activeProfileIds: ['first', 'second'], loadStatus: 'ok', loadError: null,
      switchWorkspace: jest.fn(), load: jest.fn().mockResolvedValue(undefined),
      loadProfileWorkspace: jest.fn(async () => {
        await loading
        state.workspaces = timing === 'superseded-load' ? [] : [target]
        state.loadStatus = timing === 'superseded-load' ? 'idle' : 'ok'
      }),
    }
    Object.assign(useConnectionStore, { getState: () => connection })
    Object.assign(useWorkspaceStore, { getState: () => state })
    ;(useConnectionStore as unknown as jest.Mock).mockImplementation(selector => selector(connection))
    ;(useWorkspaceStore as unknown as jest.Mock).mockImplementation(() => state)
    useWorkspaceShortcutsStore.getState().touch('host:1', 'second', 'Second', target)
    let renderer!: ReactTestRenderer.ReactTestRenderer
    await act(async () => { renderer = ReactTestRenderer.create(<WorkspaceListScreen key="first" />) })
    let opening!: Promise<void>
    act(() => {
      opening = renderer.root.findAllByType(TouchableOpacity)
        .find(row => row.props.testID === 'workspace-shortcut-second-same-id')!.props.onPress()
    })
    // profile:open updates the navigation key before workspace:load finishes.
    connection.profileViewKey = 'second'
    state.activeLocalProfileId = 'second'
    state.workspaces = []
    state.loadStatus = 'idle'
    const newNavigate = jest.fn()
    if (timing !== 'before-load') {
      await act(async () => { finish(); await opening })
      expect(mockNavigate).not.toHaveBeenCalled()
    }
    mockCurrentNavigate = newNavigate
    await act(async () => { renderer.update(<WorkspaceListScreen key="second" />) })
    if (timing === 'before-load') {
      // Focus on the new list must not invalidate the load already in progress.
      let blur!: () => void
      act(() => { blur = (useFocusEffect as jest.Mock).mock.calls.at(-2)![0]() })
      expect(state.load).not.toHaveBeenCalled()
      blur()
      await act(async () => { finish(); await opening })
    }
    if (timing === 'superseded-load') {
      expect(newNavigate).not.toHaveBeenCalled()
      state.workspaces = [target]
      state.loadStatus = 'ok'
      await act(async () => { renderer.update(<WorkspaceListScreen key="second" />) })
    }
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(newNavigate).toHaveBeenCalledTimes(1)
    expect(newNavigate).toHaveBeenCalledWith('WorkspaceDetail', { workspaceId: 'same-id' })
    expect(state.loadProfileWorkspace).toHaveBeenCalledTimes(1)
    expect(useWorkspaceNavigationStore.getState().pending).toBeNull()
    act(() => renderer.unmount())
  },
)

test('the list shows another profile running before its shortcut is opened', async () => {
  const target = { id: 'w', name: 'Target', folderPath: '/target', createdAt: 0 }
  const read = jest.fn(async (channel: string) => channel === 'workspace:load'
    ? JSON.stringify({ terminals: [{ id: 's', workspaceId: 'w', agentPreset: 'codex-agent' }] })
    : { isStreaming: true })
  const client = {
    supportsProfileContext: true,
    invokeParams: jest.fn(async (channel: string) => channel === 'profile:open'
      ? { contextId: 'ctx-second', profileId: 'second', status: 'ready' } : { ok: true }),
    scoped: () => ({ invokeParams: read }),
  }
  const connection = { host: 'host', port: 1, client, channels: {}, status: 'connected', disconnect: jest.fn() }
  const state = {
    workspaces: [], terminals: [], activeLocalProfileId: 'first', activeProfileIds: ['first', 'second'],
    profiles: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
    loadStatus: 'empty', load: jest.fn(), loadProfileWorkspace: jest.fn(), switchWorkspace: jest.fn(),
  }
  Object.assign(useConnectionStore, { getState: () => connection })
  Object.assign(useWorkspaceStore, { getState: () => state })
  ;(useConnectionStore as unknown as jest.Mock).mockImplementation(selector => selector(connection))
  ;(useWorkspaceStore as unknown as jest.Mock).mockImplementation(() => state)
  useWorkspaceShortcutsStore.getState().touch('host:1', 'second', 'Second', target)
  let renderer!: ReactTestRenderer.ReactTestRenderer
  await act(async () => { renderer = ReactTestRenderer.create(<WorkspaceListScreen />) })
  let blur!: () => void
  await act(async () => {
    blur = (useFocusEffect as jest.Mock).mock.calls.at(-1)![0]()
    await jest.advanceTimersByTimeAsync(0)
  })
  const shortcut = renderer.root.findAllByType(TouchableOpacity)
    .find(row => row.props.testID === 'workspace-shortcut-second-w')!
  expect(shortcut.findAllByType(Text).some(text =>
    Array.isArray(text.props.children) && text.props.children.join('') === 'session.activity.working 1')).toBe(true)
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(state.loadProfileWorkspace).not.toHaveBeenCalled()
  act(() => { blur(); renderer.unmount() })
})
