import React from 'react'
import ReactTestRenderer, { act } from 'react-test-renderer'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { WorkspaceListScreen } from '../src/screens/WorkspaceListScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useWorkspaceShortcutsStore } from '../src/stores/workspace-shortcuts-store'
import { useWorkspaceNavigationStore } from '../src/stores/workspace-navigation-store'
import { useWorkspaceBrowserStore } from '../src/stores/workspace-browser-store'

const mockSetOptions = jest.fn()
const mockNavigate = jest.fn()
let mockCurrentNavigate = mockNavigate

jest.useFakeTimers()

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    navigate: mockCurrentNavigate,
    reset: mockCurrentNavigate,
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
  useWorkspaceBrowserStore.setState({ servers: {} })
  useWorkspaceNavigationStore.setState({ pending: null, error: null })
})

jest.mock('../src/stores/workspace-store', () => ({
  useWorkspaceStore: jest.fn(),
}))

test('filtering never switches profiles; only explicit opening changes the mobile view', async () => {
  const activate = jest.fn()
  const deactivate = jest.fn()
  const loadProfileWorkspace = jest.fn().mockResolvedValue(undefined)
  const disconnect = jest.fn()
  const channels = { profile: { activate, deactivate } }
  const connectionStoreMock = useConnectionStore as unknown as jest.Mock
  const workspaceStoreMock = useWorkspaceStore as unknown as jest.Mock

  const connection = { channels, disconnect, host: 'host', port: 1, client: {} }
  Object.assign(useConnectionStore, { getState: () => connection })
  connectionStoreMock.mockImplementation(selector => selector(connection))
  const state = {
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
  }
  Object.assign(useWorkspaceStore, { getState: () => state })
  workspaceStoreMock.mockReturnValue(state)

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

  expect(loadProfileWorkspace).not.toHaveBeenCalled()
  expect(useWorkspaceBrowserStore.getState().servers['host:1'].profileId).toBe('lineage')
  expect(state.activeLocalProfileId).toBe('default')
  act(() => { headerRight().props.onPress() })
  act(() => renderer!.root.findAllByType(TextInput).find(node => node.props.placeholder === 'workspaceBrowser.searchProfiles')!.props.onChangeText('lin'))
  expect(renderer!.root.findAllByType(TouchableOpacity).some(row => row.props.testID === 'profile-filter-default')).toBe(false)
  const openRow = renderer!.root.findAllByType(TouchableOpacity).find(row => row.props.testID === 'profile-open-lineage')!
  await act(async () => { await openRow.props.onPress() })

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
      expect(mockNavigate).toHaveBeenCalledWith({ index: 1, routes: [
        { name: 'WorkspaceList' },
        { name: 'WorkspaceDetail', params: { workspaceId: 'same-id', workspaceNavigationId: expect.any(Number) } },
      ] })
      expect(state.switchWorkspace).toHaveBeenCalledWith('same-id')
      expect(useWorkspaceNavigationStore.getState().pending?.navigating).toBe(true)
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
    expect(newNavigate).toHaveBeenCalledWith({ index: 1, routes: [
      { name: 'WorkspaceList' },
      { name: 'WorkspaceDetail', params: { workspaceId: 'same-id', workspaceNavigationId: expect.any(Number) } },
    ] })
    expect(state.loadProfileWorkspace).toHaveBeenCalledTimes(1)
    expect(useWorkspaceNavigationStore.getState().pending?.navigating).toBe(true)
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
  let stopClock!: () => void
  await act(async () => {
    // Focus both the expiry clock and the shortcut activity subscription.
    // Covered screens now deliberately leave the clock stopped.
    const effects = (useFocusEffect as jest.Mock).mock.calls.slice(-2)
    stopClock = effects[0][0]()
    blur = effects[1][0]()
    await jest.advanceTimersByTimeAsync(0)
  })
  const shortcut = renderer.root.findAllByType(TouchableOpacity)
    .find(row => row.props.testID === 'workspace-shortcut-second-w')!
  expect(shortcut.findAllByType(Text).some(text =>
    Array.isArray(text.props.children) && text.props.children.join('').includes('session.activity.working 1'))).toBe(true)
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(state.loadProfileWorkspace).not.toHaveBeenCalled()
  read.mockRejectedValue(new Error('Remote unavailable'))
  await act(async () => { await jest.advanceTimersByTimeAsync(45_000) })
  expect(shortcut.findAllByType(Text).some(text => text.props.children === 'workspaceBrowser.statusUnknown')).toBe(true)
  act(() => { stopClock(); blur(); renderer.unmount() })
})

test('workspace and profile searches can be cleared; pins can be reordered directly in All', async () => {
  const connection = { host: 'host', port: 1, client: {}, channels: {}, status: 'disconnected', disconnect: jest.fn() }
  const state = {
    workspaces: [
      { id: 'a', name: 'Alpha', folderPath: '/a' },
      { id: 'b', name: 'Beta', folderPath: '/b' },
    ],
    profiles: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }],
    terminals: [], activeLocalProfileId: 'first', activeProfileIds: ['first'], loadStatus: 'ok',
    load: jest.fn(), switchWorkspace: jest.fn(), loadProfileWorkspace: jest.fn(),
  }
  Object.assign(useConnectionStore, { getState: () => connection })
  Object.assign(useWorkspaceStore, { getState: () => state })
  ;(useConnectionStore as unknown as jest.Mock).mockImplementation(selector => selector(connection))
  ;(useWorkspaceStore as unknown as jest.Mock).mockImplementation(() => state)
  let renderer!: ReactTestRenderer.ReactTestRenderer
  await act(async () => { renderer = ReactTestRenderer.create(<WorkspaceListScreen />) })
  const button = (id: string) => renderer.root.findAllByType(TouchableOpacity).find(row => row.props.testID === id)!
  const input = (id: string) => renderer.root.findAllByType(TextInput).find(row => row.props.testID === id)!
  const order = () => renderer.root.findAllByType(TouchableOpacity)
    .map(row => row.props.testID).filter((id: string) => id?.startsWith('workspace-shortcut-'))

  act(() => input('workspace-search').props.onChangeText('Beta'))
  expect(order()).toEqual(['workspace-shortcut-first-b'])
  act(() => button('workspace-search-clear').props.onPress())
  expect(input('workspace-search').props.value).toBe('')
  expect(button('workspace-search-clear')).toBeUndefined()
  expect(order()).toEqual(['workspace-shortcut-first-a', 'workspace-shortcut-first-b'])

  act(() => button('workspace-pin-first-b').props.onPress())
  expect(order()).toEqual(['workspace-shortcut-first-b', 'workspace-shortcut-first-a'])
  act(() => button('workspace-pin-first-a').props.onPress())
  act(() => button('workspace-reorder').props.onPress())
  expect(button('workspace-move-up-first-b').props.disabled).toBe(true)
  act(() => button('workspace-move-up-first-a').props.onPress())
  expect(order()).toEqual(['workspace-shortcut-first-a', 'workspace-shortcut-first-b'])
  act(() => button('workspace-reorder').props.onPress())
  act(() => button('workspace-mode-pinned').props.onPress())
  expect(order()).toEqual(['workspace-shortcut-first-a', 'workspace-shortcut-first-b'])

  act(() => button('workspace-profile-filter').props.onPress())
  act(() => input('profile-search').props.onChangeText('Second'))
  expect(button('profile-filter-first')).toBeUndefined()
  act(() => button('profile-search-clear').props.onPress())
  expect(button('profile-filter-first')).toBeDefined()
  expect(state.loadProfileWorkspace).not.toHaveBeenCalled()
  expect(mockNavigate).not.toHaveBeenCalled()
  act(() => renderer.unmount())
})

test('explicit opening of an empty profile completes at the overview without picking a workspace', async () => {
  const connection = { host: 'host', port: 1, channels: {}, client: {}, disconnect: jest.fn() }
  const state: any = { workspaces: [], terminals: [], activeLocalProfileId: 'first', activeProfileIds: ['first'],
    profiles: [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }], loadStatus: 'empty', loadError: null,
    switchWorkspace: jest.fn(), load: jest.fn().mockResolvedValue(undefined),
    loadProfileWorkspace: jest.fn(async () => { state.activeLocalProfileId = 'second' }) }
  Object.assign(useConnectionStore, { getState: () => connection })
  Object.assign(useWorkspaceStore, { getState: () => state })
  ;(useConnectionStore as unknown as jest.Mock).mockImplementation(selector => selector(connection))
  ;(useWorkspaceStore as unknown as jest.Mock).mockImplementation(() => state)
  let renderer!: ReactTestRenderer.ReactTestRenderer
  await act(async () => { renderer = ReactTestRenderer.create(<WorkspaceListScreen />) })
  act(() => mockSetOptions.mock.calls.at(-1)![0].headerRight().props.onPress())
  await act(async () => {
    await renderer.root.findAllByType(TouchableOpacity).find(row => row.props.testID === 'profile-open-second')!.props.onPress()
  })
  expect(state.loadProfileWorkspace).toHaveBeenCalledWith('second')
  expect(useWorkspaceNavigationStore.getState().pending).toBeNull()
  expect(mockNavigate).not.toHaveBeenCalled()
  expect(state.switchWorkspace).not.toHaveBeenCalled()
  act(() => renderer.unmount())
})
