import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { BackHandler, Text, View } from 'react-native'
import { WorkspaceNavigationTransition } from '../src/components/workspace/WorkspaceNavigationTransition'
import { WorkspaceDetailScreen } from '../src/screens/WorkspaceDetailScreen'
import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useWorkspaceNavigationStore } from '../src/stores/workspace-navigation-store'

const mockT = (key: string) => key
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}))
jest.mock('../src/components/session/SessionContextBar', () => ({ SessionContextBar: () => null }))
jest.mock('../src/hooks/use-supported-session-types', () => ({ useSupportedSessionTypes: () => [] }))

const target = { id: 'same-id', name: 'Target', folderPath: '/target', createdAt: 0 }
const destination = { profileId: 'second', profileName: 'Second', workspaceId: target.id, name: target.name }
let renderer: Renderer.ReactTestRenderer | undefined
let resolveLoad: () => void
let rejectLoad: (error: Error) => void
let loadProfileWorkspace: jest.Mock
const load = jest.fn().mockResolvedValue(undefined)

beforeEach(() => {
  jest.clearAllMocks()
  const loading = new Promise<void>((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject })
  loadProfileWorkspace = jest.fn(async () => {
    await loading
    useWorkspaceStore.setState({ activeLocalProfileId: 'second', workspaces: [target], loadStatus: 'ok' })
  })
  useConnectionStore.setState({ host: 'host', port: 1, client: {} as any, channels: {} as any, profileViewKey: 'first' })
  useWorkspaceStore.setState({
    workspaces: [{ ...target, name: 'Wrong profile' }], terminals: [],
    activeLocalProfileId: 'first', load, loadProfileWorkspace,
    profiles: [{ id: 'second', name: 'Second', type: 'local', createdAt: 0, updatedAt: 0 }],
  })
  useWorkspaceNavigationStore.setState({ pending: null, error: null })
})

afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  jest.restoreAllMocks()
})

const overlay = () => renderer!.root.findAllByProps({ testID: 'workspace-navigation-transition' })
const renderOverview = (key: string) => (
  <WorkspaceNavigationTransition><Text key={key}>Overview {key}</Text></WorkspaceNavigationTransition>
)

test('one continuous blocking state survives remounts and ends only on the destination layout', async () => {
  const back = jest.spyOn(BackHandler, 'addEventListener')
  act(() => { renderer = Renderer.create(renderOverview('first')) })
  let opening!: Promise<void>
  act(() => { opening = useWorkspaceNavigationStore.getState().open(destination) })
  const requestId = useWorkspaceNavigationStore.getState().pending!.id
  expect(overlay().length).toBeGreaterThan(0)
  expect(renderer!.root.findAllByType(Text).some(node => node.props.children === 'Second / Target')).toBe(true)
  const content = () => renderer!.root.findAllByType(View).find(node => node.props.importantForAccessibility !== undefined)!
  expect(content().props.pointerEvents).toBe('none')
  expect(content().props.importantForAccessibility).toBe('no-hide-descendants')
  expect(back.mock.calls.at(-1)![1]()).toBe(true)

  await act(async () => { await useWorkspaceNavigationStore.getState().open({ profileId: 'third', workspaceId: 'other' }) })
  expect(loadProfileWorkspace).toHaveBeenCalledTimes(1)
  act(() => {
    useConnectionStore.setState({ profileViewKey: 'second' })
    renderer!.update(renderOverview('second'))
  })
  expect(overlay().length).toBeGreaterThan(0)
  await act(async () => { resolveLoad(); await opening })
  act(() => useWorkspaceNavigationStore.getState().arrive(requestId))
  expect(overlay().length).toBeGreaterThan(0)

  act(() => useWorkspaceNavigationStore.getState().beginNavigation(requestId))
  // An old callback (including a workspace with the same ID) cannot finish this request.
  act(() => useWorkspaceNavigationStore.getState().arrive(requestId - 1))
  expect(overlay().length).toBeGreaterThan(0)
  await act(async () => {
    renderer!.update(
      <WorkspaceNavigationTransition>
        <WorkspaceDetailScreen
          route={{ key: 'target', name: 'WorkspaceDetail', params: { workspaceId: target.id, workspaceNavigationId: requestId } }}
          navigation={{ setOptions: jest.fn() } as any}
        />
      </WorkspaceNavigationTransition>,
    )
  })
  expect(overlay().length).toBeGreaterThan(0)
  expect(load).not.toHaveBeenCalled()
  const detail = renderer!.root.findByType(WorkspaceDetailScreen)
  act(() => detail.findAllByType(View).find(node => node.props.onLayout)!.props.onLayout())
  expect(overlay()).toHaveLength(0)
  expect(content().props.pointerEvents).toBe('auto')
  expect(useWorkspaceNavigationStore.getState().pending).toBeNull()
})

test('a failed switch removes the blocker and preserves the error for retry', async () => {
  act(() => { renderer = Renderer.create(renderOverview('first')) })
  let opening!: Promise<void>
  act(() => { opening = useWorkspaceNavigationStore.getState().open(destination) })
  await act(async () => { rejectLoad(new Error('offline')); await opening })
  expect(overlay()).toHaveLength(0)
  expect(useWorkspaceNavigationStore.getState().error).toContain('offline')
})

test('disconnect removes the blocker even when no workspace list remains mounted', async () => {
  act(() => { renderer = Renderer.create(renderOverview('first')) })
  let opening!: Promise<void>
  act(() => { opening = useWorkspaceNavigationStore.getState().open(destination) })
  act(() => {
    useConnectionStore.setState({ client: null, channels: null, host: null })
    renderer!.update(<WorkspaceNavigationTransition><Text>Connect</Text></WorkspaceNavigationTransition>)
  })
  expect(overlay()).toHaveLength(0)
  await act(async () => { resolveLoad(); await opening })
  expect(useWorkspaceNavigationStore.getState().pending).toBeNull()
  expect(useWorkspaceNavigationStore.getState().error).toBeNull()
})
