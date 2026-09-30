import { useWorkspaceStore } from '../src/stores/workspace-store'
import { useConnectionStore } from '../src/stores/connection-store'
import {
  agentPreferenceScope,
  useAgentPreferencesStore,
} from '../src/stores/agent-preferences-store'

test('new session inherits saved effort without replacing or resetting the old session', async () => {
  const old = {
    id: 'old',
    workspaceId: 'w',
    type: 'terminal',
    agentPreset: 'codex-agent',
    title: 'old',
    cwd: '/repo',
    scrollbackBuffer: [],
    sdkSessionId: 'existing-sdk',
  }
  const save = jest.fn().mockResolvedValue(true)
  useConnectionStore.setState({
    client: null,
    channels: { workspace: { save } } as never,
    profileViewKey: 'p',
  })
  useWorkspaceStore.setState({
    workspaces: [{ id: 'w', name: 'repo', folderPath: '/repo', createdAt: 0 }],
    terminals: [old] as never,
    activeLocalProfileId: 'p',
    activeWorkspaceId: 'w',
    activeTerminalId: 'old',
  })
  const scope = agentPreferenceScope(useConnectionStore.getState(), 'p')
  useAgentPreferencesStore
    .getState()
    .remember(scope, 'old', 'codex-agent', 'xhigh')
  const created = await useWorkspaceStore
    .getState()
    .requestAddSession('w', 'codex-agent')
  expect(created.id).not.toBe('old')
  expect(created.agentParams?.effortLevel).toBe('xhigh')
  const snapshot = JSON.parse(save.mock.calls[0][0])
  expect(snapshot.terminals).toHaveLength(2)
  expect(snapshot.terminals[0]).toEqual(old)
  expect(snapshot.terminals[1].sdkSessionId).toBeUndefined()
})
