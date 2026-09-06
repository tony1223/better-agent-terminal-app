import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useClaudeStore } from '../src/stores/claude-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function mockClient() {
  const invoke = jest.fn().mockResolvedValue({ ok: true })
  const invokeParams = jest.fn().mockImplementation((channel, params) => Promise.resolve(
    channel === 'profile:open'
      ? { contextId: `ctx-${params.profileId}`, profileId: params.profileId, name: params.profileId,
        bindingKey: params.profileId, status: 'ready' }
      : { ok: true },
  ))
  return { supportsProfileContext: true, isConnected: true, invoke, invokeParams,
    scoped: jest.fn().mockReturnValue({ invoke, invokeParams, on: jest.fn().mockReturnValue(() => {}) }),
    on: jest.fn().mockReturnValue(() => {}), disconnect: jest.fn() }
}

beforeEach(() => {
  useConnectionStore.getState().disconnect()
  useClaudeStore.getState().switchScope('test-root')
  useClaudeStore.setState({ sessions: {} })
  useConnectionStore.setState({ channels: {} as any, host: 'entry', port: 1234, status: 'connected' })
})

afterEach(() => useConnectionStore.getState().disconnect())

test('local and remote selections use the same open contract and stale channels fail closed', async () => {
  const client = mockClient()
  useConnectionStore.setState({ client: client as any })
  const a = await useConnectionStore.getState().selectProfile('local')
  await useConnectionStore.getState().selectProfile('remote')
  expect(client.invokeParams).toHaveBeenCalledWith('profile:open', { profileId: 'local' })
  expect(client.invokeParams).toHaveBeenCalledWith('profile:open', { profileId: 'remote' })
  await expect(a.claude.sendMessage('same-id', 'hello')).rejects.toThrow('Profile selection changed')
  expect(client.invokeParams).not.toHaveBeenCalledWith('agent:send-message', expect.anything(), expect.anything())
})

test('a late profile open cannot replace the newer selection', async () => {
  const client = mockClient()
  const late = deferred<any>()
  client.invokeParams.mockImplementation((channel, params) => {
    if (channel === 'profile:open' && params.profileId === 'a') return late.promise
    return Promise.resolve({ contextId: 'ctx-b', profileId: 'b', bindingKey: 'b', status: 'ready' })
  })
  useConnectionStore.setState({ client: client as any })
  const a = useConnectionStore.getState().selectProfile('a')
  const outcome = a.catch(error => error)
  await useConnectionStore.getState().selectProfile('b')
  late.resolve({ contextId: 'ctx-a', profileId: 'a', bindingKey: 'a', status: 'ready' })
  expect(await outcome).toEqual(new Error('Profile selection changed'))
  expect(useConnectionStore.getState().profileContext?.profileId).toBe('b')
  expect(client.invokeParams).toHaveBeenCalledWith('profile:close', { contextId: 'ctx-a' })
})

test('an invalidated context is reopened on refresh instead of being cached as ready', async () => {
  const client = mockClient()
  useConnectionStore.setState({ client: client as any })
  const channels = await useConnectionStore.getState().selectProfile('a')
  client.invoke.mockRejectedValueOnce(new Error('Profile changed or was removed. Select it again.'))
  await expect(channels.fs.home()).rejects.toThrow('Profile changed')
  expect(useConnectionStore.getState().profileStatus).toBe('unavailable')
  await useConnectionStore.getState().selectProfile('a')
  expect(client.invokeParams.mock.calls.filter(([channel]) => channel === 'profile:open')).toHaveLength(2)
})

test('a context load failure never reads the entry host snapshot', async () => {
  const client = mockClient()
  client.invokeParams.mockRejectedValue(new Error('Profile unavailable'))
  const loadSnapshot = jest.fn()
  useConnectionStore.setState({ client: client as any, channels: { profile: { loadSnapshot } } as any })
  await expect(useWorkspaceStore.getState().loadProfileWorkspace('remote')).rejects.toThrow('Profile unavailable')
  expect(loadSnapshot).not.toHaveBeenCalled()
  expect(useWorkspaceStore.getState().loadStatus).toBe('rpc-error')
})

test('identical session IDs and a late send failure stay with their original profile', async () => {
  const store = useClaudeStore.getState()
  store.switchScope('a')
  store.handleMessage('same-id', { id: 'user-local-test', sessionId: 'same-id', role: 'user',
    content: 'hello from a', timestamp: 1, status: 'sending', sendPayload: { messageText: 'hello from a' } })
  const sending = deferred<any>()
  useConnectionStore.setState({ channels: { claude: { sendMessage: () => sending.promise } } as any })
  const delivery = store.deliverUserMessage('same-id', 'user-local-test', { messageText: 'hello from a' })
  store.switchScope('b')
  store.handleMessage('same-id', { id: 'user-local-test', sessionId: 'same-id', role: 'user',
    content: 'hello from b', timestamp: 2, status: 'sent' })
  sending.reject(new Error('Connection closed'))
  await delivery
  expect(useClaudeStore.getState().sessions['same-id'].messages[0]).toMatchObject({ content: 'hello from b', status: 'sent' })
  store.switchScope('a')
  expect(useClaudeStore.getState().sessions['same-id'].messages[0]).toMatchObject({ content: 'hello from a', status: 'failed' })
})

test('a failed save in the old profile cannot roll back the newly selected workspace', async () => {
  const save = deferred<boolean>()
  const original = { workspace: { save: () => save.promise } }
  useConnectionStore.setState({ channels: original as any })
  useWorkspaceStore.setState({ activeLocalProfileId: 'a', activeWorkspaceId: 'a-ws',
    terminals: [], workspaces: [{ id: 'a-ws', name: 'A', folderPath: '/a', createdAt: 1 }] })
  const adding = useWorkspaceStore.getState().requestAddSession('a-ws', 'codex-agent').catch(e => e)
  useConnectionStore.setState({ channels: {} as any })
  useWorkspaceStore.setState({ activeLocalProfileId: 'b', activeWorkspaceId: 'b-ws',
    terminals: [], workspaces: [{ id: 'b-ws', name: 'B', folderPath: '/b', createdAt: 1 }] })
  save.reject(new Error('Connection closed'))
  expect(await adding).toEqual(new Error('Connection closed'))
  expect(useWorkspaceStore.getState().workspaces[0].id).toBe('b-ws')
})

test('removing the selected profile does not select a default execution target', async () => {
  const client = mockClient()
  client.invokeParams.mockRejectedValue(new Error('Profile not found'))
  useConnectionStore.setState({ client: client as any })
  useWorkspaceStore.setState({ activeLocalProfileId: 'removed', profiles: [] })
  useWorkspaceStore.getState().handleProfileChanged({ profiles: [{ id: 'default', type: 'local' }], activeProfileIds: ['default'] })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(client.invokeParams).toHaveBeenCalledWith('profile:open', { profileId: 'removed' })
  expect(useWorkspaceStore.getState().activeLocalProfileId).toBe('removed')
})
