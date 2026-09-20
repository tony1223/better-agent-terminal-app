/**
 * A worker panel is a terminal record with `procfilePath` set and nothing
 * running under its own id. Adding one must write the same shape the desktop
 * does, so it opens as a worker panel there; closing one must not kill a PTY
 * that does not exist, and must not touch the Procfile processes, which are
 * the host's (the desktop skips that teardown for remote clients too).
 */

import { useConnectionStore } from '../src/stores/connection-store'
import { useWorkspaceStore } from '../src/stores/workspace-store'

const workspace = {
  id: 'ws',
  name: 'repo',
  folderPath: 'C:\\repo',
  createdAt: 1,
}

function connect() {
  const channels = {
    workspace: {
      save: jest.fn().mockResolvedValue(true),
      load: jest.fn().mockResolvedValue(JSON.stringify({
        workspaces: [workspace],
        terminals: [],
        activeWorkspaceId: 'ws',
        activeTerminalId: null,
      })),
    },
    profile: {
      list: jest.fn().mockResolvedValue({ profiles: [{ id: 'p', name: 'P', type: 'local' }], activeProfileIds: ['p'] }),
      loadSnapshot: jest.fn(),
    },
    pty: { kill: jest.fn().mockResolvedValue(true) },
    claude: { stopSession: jest.fn().mockResolvedValue(true) },
    worker: { stopProcess: jest.fn().mockResolvedValue(true) },
  }
  useConnectionStore.setState({ status: 'connected', channels: channels as never })
  return channels
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [workspace],
    terminals: [],
    activeWorkspaceId: 'ws',
    activeTerminalId: null,
    activeLocalProfileId: 'p',
    profiles: [{ id: 'p', name: 'P', type: 'local' }] as never,
    activeProfileIds: ['p'],
    loadStatus: 'ok',
    loadError: null,
  })
})

afterEach(() => {
  useConnectionStore.setState({ status: 'disconnected', channels: null })
})

describe('requestAddWorker', () => {
  it('saves a plain terminal record marked only by procfilePath', async () => {
    const channels = connect()
    const terminal = await useWorkspaceStore.getState().requestAddWorker('ws', 'C:\\repo\\Procfile.dev')

    expect(terminal).toMatchObject({
      workspaceId: 'ws',
      type: 'terminal',
      title: 'Worker: Procfile.dev',
      cwd: 'C:\\repo',
      procfilePath: 'C:\\repo\\Procfile.dev',
    })
    expect(terminal.agentPreset).toBeUndefined()

    const saved = JSON.parse(channels.workspace.save.mock.calls[0][0])
    expect(saved.terminals).toHaveLength(1)
    expect(saved.terminals[0].procfilePath).toBe('C:\\repo\\Procfile.dev')
    expect(saved.activeTerminalId).toBe(terminal.id)
    expect(useWorkspaceStore.getState().terminals[0].id).toBe(terminal.id)
  })

  it('rolls back when the host rejects the save', async () => {
    const channels = connect()
    channels.workspace.save.mockResolvedValueOnce(false)
    await expect(useWorkspaceStore.getState().requestAddWorker('ws', 'C:\\repo\\Procfile')).rejects.toThrow()
    expect(useWorkspaceStore.getState().terminals).toHaveLength(0)
  })
})

describe('requestCloseSession on a worker panel', () => {
  it('removes the record without killing a pty or stopping its processes', async () => {
    const channels = connect()
    useWorkspaceStore.setState({
      terminals: [{
        id: 'panel-1',
        workspaceId: 'ws',
        type: 'terminal',
        title: 'Worker: Procfile',
        cwd: 'C:\\repo',
        procfilePath: 'C:\\repo\\Procfile',
        scrollbackBuffer: [],
      }] as never,
      activeTerminalId: 'panel-1',
    })

    await useWorkspaceStore.getState().requestCloseSession('panel-1')

    expect(channels.pty.kill).not.toHaveBeenCalled()
    expect(channels.claude.stopSession).not.toHaveBeenCalled()
    expect(channels.worker.stopProcess).not.toHaveBeenCalled()
    const saved = JSON.parse(channels.workspace.save.mock.calls[0][0])
    expect(saved.terminals).toHaveLength(0)
  })
})
