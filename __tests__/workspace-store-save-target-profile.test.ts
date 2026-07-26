// A workspace save must target the profile the device is VIEWING.
//
// Regression test for a data-loss bug. The host lists one active profile per
// desktop window, in window order, so activeProfileIds[0] is unrelated to what
// this device is looking at. The save paths used to re-resolve their target
// from that list instead of the device's pinned profile, so adding a session
// while viewing "bat" sent bat's whole workspace list under profileId "game" —
// and the host, which trusts the client's profileId, overwrote game's list with
// it. Nothing detects this afterwards: the ids are opaque to the host, and on
// the next restart the desktop's duplicate-identity repair renumbered the
// adopted copies, cementing the loss.
//
// The invariant: the profileId sent with a save is the same one the data was
// loaded from, never a fresh resolve.

import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'

// "game" is first in the host's active set — the trap the old code fell into.
const profileSummary = {
  profiles: [
    { id: 'game', name: 'Game', type: 'local' },
    { id: 'bat', name: 'Bat', type: 'local' },
  ],
  activeProfileIds: ['game', 'bat'],
}

const batWorkspace = {
  id: 'bat-ws',
  name: 'better-terminal',
  folderPath: 'C:\\workspaces\\tools\\better-terminal',
  createdAt: 1,
}

const batTerminal = {
  id: 'bat-term',
  workspaceId: 'bat-ws',
  type: 'terminal',
  title: 'Terminal',
  cwd: 'C:\\workspaces\\tools\\better-terminal',
  scrollbackBuffer: [],
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [batWorkspace],
    terminals: [batTerminal as any],
    activeWorkspaceId: 'bat-ws',
    activeTerminalId: 'bat-term',
    // The device is pinned to "bat" while the host's list starts with "game".
    activeLocalProfileId: 'bat',
    profiles: profileSummary.profiles as any,
    activeProfileIds: profileSummary.activeProfileIds,
    loadStatus: 'ok',
    loadError: null,
  })
  useConnectionStore.setState({ status: 'connected', channels: null })
})

afterEach(() => {
  useConnectionStore.setState({ status: 'disconnected', channels: null })
})

function connect(overrides: Record<string, unknown> = {}) {
  const save = jest.fn().mockResolvedValue(true)
  const channels = {
    workspace: {
      save,
      load: jest.fn().mockResolvedValue(JSON.stringify({
        workspaces: [batWorkspace],
        terminals: [batTerminal],
        activeWorkspaceId: 'bat-ws',
        activeTerminalId: 'bat-term',
      })),
    },
    profile: {
      list: jest.fn().mockResolvedValue(profileSummary),
      loadSnapshot: jest.fn(),
    },
    ...overrides,
  }
  useConnectionStore.setState({ channels: channels as any })
  return { channels, save }
}

test('adding a session saves to the viewed profile, not the host active list head', async () => {
  const { save } = connect()

  await useWorkspaceStore.getState().requestAddSession('bat-ws', 'claude-code')

  expect(save).toHaveBeenCalledTimes(1)
  const [data, profileId] = save.mock.calls[0]
  expect(profileId).toBe('bat')

  // And the payload really is bat's list — proving the pair is consistent, not
  // just that the id happens to read "bat".
  expect(JSON.parse(data).workspaces).toEqual([batWorkspace])
})

test('closing a session saves to the viewed profile', async () => {
  const { save } = connect({ pty: { kill: jest.fn().mockResolvedValue(true) } })

  await useWorkspaceStore.getState().requestCloseSession('bat-term')

  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0][1]).toBe('bat')
})

test('with no pin the save falls back to the host active set', async () => {
  useWorkspaceStore.setState({ activeLocalProfileId: null })
  const { save } = connect()

  await useWorkspaceStore.getState().requestAddSession('bat-ws', 'claude-code')

  expect(save.mock.calls[0][1]).toBe('game')
})
