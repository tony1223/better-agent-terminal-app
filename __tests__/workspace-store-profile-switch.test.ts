import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'

const profileSummary = {
  profiles: [
    { id: 'default', name: 'Default', type: 'local' },
    { id: 'mobile', name: 'Mobile', type: 'local' },
  ],
  activeProfileIds: ['default'],
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: 'old-ws',
        name: 'Old',
        folderPath: 'C:\\old',
        createdAt: 1,
      },
    ],
    terminals: [
      {
        id: 'old-term',
        workspaceId: 'old-ws',
        type: 'terminal',
        title: 'Old Terminal',
        cwd: 'C:\\old',
        scrollbackBuffer: [],
      },
    ],
    activeWorkspaceId: 'old-ws',
    activeTerminalId: 'old-term',
    activeLocalProfileId: 'default',
    profiles: profileSummary.profiles as any,
    activeProfileIds: profileSummary.activeProfileIds,
    loadStatus: 'ok',
    loadError: null,
  })
  useConnectionStore.setState({
    status: 'connected',
    channels: null,
  })
})

afterEach(() => {
  useConnectionStore.setState({
    status: 'disconnected',
    channels: null,
  })
})

test('switching profiles clears the old workspace view immediately and adopts the new profile state', async () => {
  let resolveLoad: (snapshot: string) => void = () => {}
  const loadPromise = new Promise<string>(resolve => {
    resolveLoad = resolve
  })
  const channels = {
    profile: {
      list: jest.fn().mockResolvedValue(profileSummary),
      loadSnapshot: jest.fn(),
    },
    workspace: {
      load: jest.fn().mockReturnValue(loadPromise),
    },
  }
  useConnectionStore.setState({ channels: channels as any })

  const loading = useWorkspaceStore.getState().loadProfileWorkspace('mobile')

  expect(useWorkspaceStore.getState()).toMatchObject({
    activeLocalProfileId: 'mobile',
    activeWorkspaceId: null,
    activeTerminalId: null,
    workspaces: [],
    terminals: [],
  })

  resolveLoad(JSON.stringify({
    workspaces: [
      {
        id: 'new-ws',
        name: 'New',
        folderPath: 'C:\\new',
        createdAt: 2,
      },
    ],
    activeWorkspaceId: 'new-ws',
    terminals: [
      {
        id: 'new-term',
        workspaceId: 'new-ws',
        type: 'terminal',
        title: 'New Terminal',
        cwd: 'C:\\new',
        scrollbackBuffer: ['line'],
      },
    ],
    activeTerminalId: 'new-term',
    focusedTerminalId: 'new-term',
  }))
  await loading

  expect(channels.workspace.load).toHaveBeenCalledWith('mobile')
  expect(useWorkspaceStore.getState()).toMatchObject({
    activeLocalProfileId: 'mobile',
    activeWorkspaceId: 'new-ws',
    activeTerminalId: 'new-term',
    workspaces: [{ id: 'new-ws' }],
    terminals: [{ id: 'new-term', workspaceId: 'new-ws' }],
    loadStatus: 'ok',
  })
})

test('profile summary refresh failure keeps cached profiles and loads the pinned profile', async () => {
  const channels = {
    profile: {
      list: jest.fn().mockRejectedValue(new Error('socket reconnecting')),
      loadSnapshot: jest.fn(),
    },
    workspace: {
      load: jest.fn().mockResolvedValue(JSON.stringify({
        workspaces: [
          {
            id: 'old-ws',
            name: 'Old',
            folderPath: 'C:\\old',
            createdAt: 1,
          },
        ],
        activeWorkspaceId: 'old-ws',
        terminals: [],
        activeTerminalId: null,
        focusedTerminalId: null,
      })),
    },
  }
  useConnectionStore.setState({ channels: channels as any })

  await useWorkspaceStore.getState().load()

  expect(channels.profile.list).toHaveBeenCalled()
  expect(channels.workspace.load).toHaveBeenCalledWith('default')
  expect(useWorkspaceStore.getState()).toMatchObject({
    profiles: profileSummary.profiles,
    activeProfileIds: profileSummary.activeProfileIds,
    activeLocalProfileId: 'default',
    workspaces: [{ id: 'old-ws' }],
  })
})
