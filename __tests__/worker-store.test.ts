/**
 * The worker store is a remote client of the desktop's Procfile feature, and
 * the host's contract has sharp edges: liveness is only ever answered by
 * `pty:get-cwd`, a profile context forwards a PTY's output only to clients that
 * have named it, and a restart must re-read the Procfile first. These pin that
 * the store honours each, and never sends the phone's idea of a shell.
 */

import { useWorkerStore, subscribeWorkerEvents } from '../src/stores/worker-store'
import { useConnectionStore } from '../src/stores/connection-store'

jest.mock('../src/stores/connection-store', () => ({
  useConnectionStore: { getState: jest.fn() },
}))

const getStateMock = (useConnectionStore as unknown as { getState: jest.Mock }).getState

const PANEL = 'panel-1'
const PROCFILE = 'C:\\repo\\Procfile'

function makeChannels(overrides: { alive?: string[] } = {}) {
  const alive = new Set(overrides.alive ?? [])
  const channels = {
    worker: {
      loadProcfile: jest.fn().mockResolvedValue([
        { name: 'web', command: 'npm run web' },
        { name: 'api', command: 'npm run api' },
      ]),
      startProcess: jest.fn(async (options: { panelId: string; name: string; command: string }) => `${options.panelId}__w__${options.name}`),
      stopProcess: jest.fn().mockResolvedValue(true),
    },
    pty: {
      getCwd: jest.fn(async (id: string) => (alive.has(id) ? 'C:\\repo' : null)),
    },
  }
  getStateMock.mockReturnValue({ channels })
  return channels
}

beforeEach(() => {
  jest.useFakeTimers()
  useWorkerStore.setState({ panels: {} })
})

afterEach(() => {
  jest.useRealTimers()
  jest.clearAllMocks()
})

describe('refresh', () => {
  it('reads the Procfile, colours by position, and probes each process with get-cwd', async () => {
    const channels = makeChannels({ alive: [`${PANEL}__w__api`] })
    const roster = await useWorkerStore.getState().refresh(PANEL, PROCFILE)

    expect(channels.worker.loadProcfile).toHaveBeenCalledWith(PROCFILE)
    expect(channels.pty.getCwd).toHaveBeenCalledWith(`${PANEL}__w__web`)
    expect(channels.pty.getCwd).toHaveBeenCalledWith(`${PANEL}__w__api`)
    expect(roster.map(p => [p.name, p.status])).toEqual([['web', 'stopped'], ['api', 'running']])
    expect(roster[0].color).not.toBe(roster[1].color)
  })

  it('marks a process stopped when it was running and the host no longer has it', async () => {
    makeChannels({ alive: [`${PANEL}__w__web`] })
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    makeChannels({ alive: [] })
    const roster = await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    expect(roster.find(p => p.name === 'web')?.status).toBe('stopped')
  })

  it('is throttled by maxAgeMs', async () => {
    const channels = makeChannels()
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    await useWorkerStore.getState().refresh(PANEL, PROCFILE, { maxAgeMs: 10_000 })
    expect(channels.worker.loadProcfile).toHaveBeenCalledTimes(1)
  })

  it('records a load failure on the panel and rethrows', async () => {
    const channels = makeChannels()
    channels.worker.loadProcfile.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(useWorkerStore.getState().refresh(PANEL, PROCFILE)).rejects.toThrow('ENOENT')
    expect(useWorkerStore.getState().panels[PANEL]?.error).toBe('ENOENT')
  })
})

describe('start', () => {
  it('starts from the Procfile directory without a shell, then registers interest in the pty', async () => {
    const channels = makeChannels()
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    channels.pty.getCwd.mockClear()

    await useWorkerStore.getState().start(PANEL, 'web', 'C:\\fallback')

    const options = channels.worker.startProcess.mock.calls[0][0]
    expect(options).toEqual({
      panelId: PANEL,
      name: 'web',
      command: 'npm run web',
      cwd: 'C:\\repo',
      customEnv: {},
    })
    expect('shell' in options).toBe(false)
    expect(channels.pty.getCwd).toHaveBeenCalledWith(`${PANEL}__w__web`)
    expect(useWorkerStore.getState().panels[PANEL].processes[0].status).toBe('starting')

    jest.advanceTimersByTime(300)
    expect(useWorkerStore.getState().panels[PANEL].processes[0].status).toBe('running')
  })

  it('returns the process to stopped when the host refuses', async () => {
    const channels = makeChannels()
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    channels.worker.startProcess.mockRejectedValueOnce(new Error('spawn failed'))
    await expect(useWorkerStore.getState().start(PANEL, 'web', 'C:\\fallback')).rejects.toThrow('spawn failed')
    expect(useWorkerStore.getState().panels[PANEL].processes[0].status).toBe('stopped')
  })
})

describe('stop and restart', () => {
  it('stop tolerates a process that is already gone', async () => {
    const channels = makeChannels({ alive: [`${PANEL}__w__web`] })
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    channels.worker.stopProcess.mockRejectedValueOnce(new Error('no such process'))
    await useWorkerStore.getState().stop(PANEL, 'web')
    expect(useWorkerStore.getState().panels[PANEL].processes[0].status).toBe('stopped')
  })

  it('restart re-reads the Procfile, then stops, then starts', async () => {
    const channels = makeChannels({ alive: [`${PANEL}__w__web`] })
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    const order: string[] = []
    channels.worker.loadProcfile.mockImplementation(async () => {
      order.push('load')
      return [{ name: 'web', command: 'npm run web -- --changed' }]
    })
    channels.worker.stopProcess.mockImplementation(async () => { order.push('stop'); return true })
    channels.worker.startProcess.mockImplementation(async () => { order.push('start'); return `${PANEL}__w__web` })

    await useWorkerStore.getState().restart(PANEL, 'web', 'C:\\fallback')

    expect(order).toEqual(['load', 'stop', 'start'])
    expect(channels.worker.startProcess.mock.calls[0][0].command).toBe('npm run web -- --changed')
  })
})

describe('pty events', () => {
  function subscribeWith() {
    const handlers: { output?: (id: string, data: string) => void; exit?: (id: string, code: number) => void } = {}
    const pty = {
      onOutput: jest.fn((fn: (id: string, data: string) => void) => { handlers.output = fn; return () => undefined }),
      onExit: jest.fn((fn: (id: string, code: number) => void) => { handlers.exit = fn; return () => undefined }),
    }
    const unsubscribe = subscribeWorkerEvents(pty as never)
    return { handlers, unsubscribe }
  }

  it('flips a process to running on its first output', async () => {
    makeChannels()
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    const { handlers } = subscribeWith()
    handlers.output!(`${PANEL}__w__web`, 'listening\n')
    expect(useWorkerStore.getState().panels[PANEL].processes[0].status).toBe('running')
  })

  it('records a crash with its exit code and a clean exit as stopped', async () => {
    makeChannels({ alive: [`${PANEL}__w__web`, `${PANEL}__w__api`] })
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    const { handlers } = subscribeWith()
    handlers.exit!(`${PANEL}__w__web`, 1)
    handlers.exit!(`${PANEL}__w__api`, 0)
    const [web, api] = useWorkerStore.getState().panels[PANEL].processes
    expect(web).toMatchObject({ status: 'crashed', exitCode: 1 })
    expect(api).toMatchObject({ status: 'stopped', exitCode: 0 })
  })

  it('ignores ordinary terminal ptys', async () => {
    makeChannels()
    await useWorkerStore.getState().refresh(PANEL, PROCFILE)
    const { handlers } = subscribeWith()
    const before = useWorkerStore.getState().panels
    handlers.exit!('terminal-9', 1)
    expect(useWorkerStore.getState().panels).toBe(before)
  })
})
