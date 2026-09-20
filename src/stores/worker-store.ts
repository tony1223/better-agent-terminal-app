/**
 * Which processes a worker panel has, and whether each is up.
 *
 * The host keeps no such roster. A panel is a Procfile path; its processes are
 * whatever that file says right now, and "running" is answered per process by
 * `pty:get-cwd` on the composite id. So this store holds what the desktop's
 * WorkerPanel keeps in component state, lifted out so a session row can show
 * it without opening the panel.
 *
 * Log text is not kept here — the screen streams it into its own view and the
 * host holds the persisted copy. Status changes are all this store needs from
 * the pty events: any output means alive, an exit means stopped or crashed.
 */

import { create } from 'zustand'
import type { Channels } from '@/api/channels'
import { useConnectionStore } from '@/stores/connection-store'
import { dlog } from '@/utils/debug-log'
import {
  WORKER_COLORS,
  deriveWorkerActivity,
  procfileDirectory,
  splitWorkerPtyId,
  workerPtyId,
  worktreeProcessEnv,
  type WorkerProcess,
} from '@/utils/worker'
import type { SessionActivity } from '@/utils/session-status'

export interface WorkerPanelState {
  procfilePath: string
  processes: WorkerProcess[]
  /** When the roster was last read from the host, for throttling list-driven refreshes. */
  refreshedAt: number
  error: string | null
}

interface WorkerState {
  panels: Record<string, WorkerPanelState>
  /**
   * Read the Procfile and probe each process. The probe is `pty:get-cwd`, which
   * is also what registers this client's interest in the PTY under a profile
   * context — without it the host would not forward the process's output to us.
   */
  refresh: (panelId: string, procfilePath: string, options?: { maxAgeMs?: number }) => Promise<WorkerProcess[]>
  start: (panelId: string, name: string, cwdFallback: string) => Promise<void>
  stop: (panelId: string, name: string) => Promise<void>
  /** Re-reads the Procfile first, like the desktop, so a changed command takes. */
  restart: (panelId: string, name: string, cwdFallback: string) => Promise<void>
  startAll: (panelId: string, cwdFallback: string) => Promise<void>
  stopAll: (panelId: string) => Promise<void>
  forget: (panelId: string) => void
  /** Internal: apply a status change from a pty event. */
  markProcess: (panelId: string, name: string, patch: Partial<WorkerProcess>) => void
}

const STARTING_GRACE_MS = 300

function requireChannels(): Channels {
  const channels = useConnectionStore.getState().channels
  if (!channels) throw new Error('Not connected to remote server')
  return channels
}

function buildRoster(
  panelId: string,
  entries: { name: string; command: string }[],
  previous: WorkerProcess[] | undefined,
): WorkerProcess[] {
  const byName = new Map((previous ?? []).map(p => [p.name, p]))
  return entries.map((entry, i) => {
    const existing = byName.get(entry.name)
    return {
      name: entry.name,
      command: entry.command,
      ptyId: workerPtyId(panelId, entry.name),
      // Colour follows position in the file, the same rule as the desktop, so
      // both clients paint a given process the same.
      color: WORKER_COLORS[i % WORKER_COLORS.length],
      status: existing?.status ?? 'stopped',
      exitCode: existing?.exitCode,
    }
  })
}

export const useWorkerStore = create<WorkerState>((set, get) => ({
  panels: {},

  refresh: async (panelId, procfilePath, options) => {
    const known = get().panels[panelId]
    if (known && options?.maxAgeMs != null && Date.now() - known.refreshedAt < options.maxAgeMs) {
      return known.processes
    }
    const channels = requireChannels()
    let entries: { name: string; command: string }[]
    try {
      entries = await channels.worker.loadProcfile(procfilePath)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      dlog('!WORKER', `procfile load failed panel=${panelId} path=${procfilePath}: ${error}`)
      set(state => ({
        panels: {
          ...state.panels,
          [panelId]: { procfilePath, processes: known?.processes ?? [], refreshedAt: Date.now(), error },
        },
      }))
      throw e
    }
    const roster = buildRoster(panelId, entries, known?.processes)
    // Probe liveness per process. A non-null cwd is the host's only "alive".
    await Promise.all(roster.map(async proc => {
      const cwd = await channels.pty.getCwd(proc.ptyId).catch(() => null)
      if (cwd) {
        proc.status = 'running'
        proc.exitCode = undefined
      } else if (proc.status === 'running' || proc.status === 'starting') {
        // We thought it was up and the host says nothing is there: it went
        // away while we were not listening, and no exit event will come now.
        proc.status = 'stopped'
      }
    }))
    dlog('WORKER', `roster panel=${panelId}: ${roster.map(p => `${p.name}=${p.status}`).join(' ')}`)
    set(state => ({
      panels: {
        ...state.panels,
        [panelId]: { procfilePath, processes: roster, refreshedAt: Date.now(), error: null },
      },
    }))
    return roster
  },

  start: async (panelId, name, cwdFallback) => {
    const channels = requireChannels()
    const panel = get().panels[panelId]
    const proc = panel?.processes.find(p => p.name === name)
    if (!panel || !proc) throw new Error(`No process named ${name}`)
    get().markProcess(panelId, name, { status: 'starting', exitCode: undefined })
    const cwd = procfileDirectory(panel.procfilePath, cwdFallback)
    try {
      // No `shell`: this phone's idea of a shell describes nothing on the host.
      const ptyId = await channels.worker.startProcess({
        panelId,
        name,
        command: proc.command,
        cwd,
        customEnv: worktreeProcessEnv(cwd),
      })
      // Under a profile context the host forwards a PTY's output only to
      // clients that have named it in a pty:* request, and the start channel
      // is not one. Ask for its cwd once so the events that follow reach us.
      await channels.pty.getCwd(ptyId).catch(() => null)
    } catch (e) {
      get().markProcess(panelId, name, { status: 'stopped' })
      throw e
    }
    setTimeout(() => {
      const current = get().panels[panelId]?.processes.find(p => p.name === name)
      if (current?.status === 'starting') get().markProcess(panelId, name, { status: 'running' })
    }, STARTING_GRACE_MS)
  },

  stop: async (panelId, name) => {
    const channels = requireChannels()
    // The host synthesises a pty:exit(0) on stop, which flips the status; a
    // process that was already gone answers with an error we can ignore.
    await channels.worker.stopProcess(panelId, name).catch(e => {
      dlog('WORKER', `stop panel=${panelId} name=${name}: ${e instanceof Error ? e.message : String(e)}`)
    })
    get().markProcess(panelId, name, { status: 'stopped' })
  },

  restart: async (panelId, name, cwdFallback) => {
    const panel = get().panels[panelId]
    if (!panel) return
    const roster = await get().refresh(panelId, panel.procfilePath)
    if (!roster.some(p => p.name === name)) return
    await get().stop(panelId, name)
    await get().start(panelId, name, cwdFallback)
  },

  startAll: async (panelId, cwdFallback) => {
    const panel = get().panels[panelId]
    if (!panel) return
    const roster = await get().refresh(panelId, panel.procfilePath)
    for (const proc of roster) {
      if (proc.status === 'running' || proc.status === 'starting') continue
      await get().start(panelId, proc.name, cwdFallback)
    }
  },

  stopAll: async (panelId) => {
    const panel = get().panels[panelId]
    if (!panel) return
    for (const proc of panel.processes) {
      if (proc.status !== 'running' && proc.status !== 'starting') continue
      await get().stop(panelId, proc.name)
    }
  },

  forget: (panelId) => {
    set(state => {
      if (!state.panels[panelId]) return state
      const panels = { ...state.panels }
      delete panels[panelId]
      return { panels }
    })
  },

  markProcess: (panelId, name, patch) => {
    set(state => {
      const panel = state.panels[panelId]
      if (!panel) return state
      const index = panel.processes.findIndex(p => p.name === name)
      if (index < 0) return state
      const processes = [...panel.processes]
      processes[index] = { ...processes[index], ...patch }
      return { panels: { ...state.panels, [panelId]: { ...panel, processes } } }
    })
  },
}))

export function workerPanelActivity(panelId: string): SessionActivity {
  return deriveWorkerActivity(useWorkerStore.getState().panels[panelId]?.processes)
}

/**
 * Keep process status current from the pty stream. Installed once per
 * connection from App.tsx, like the claude subscriptions, so a row on the
 * sessions list learns of a crash without the panel being open.
 */
export function subscribeWorkerEvents(pty: Channels['pty']): () => void {
  const unsubs = [
    pty.onOutput((id) => {
      const parts = splitWorkerPtyId(id)
      if (!parts) return
      const proc = useWorkerStore.getState().panels[parts.panelId]?.processes.find(p => p.name === parts.name)
      if (proc && proc.status !== 'running') {
        useWorkerStore.getState().markProcess(parts.panelId, parts.name, { status: 'running', exitCode: undefined })
      }
    }),
    pty.onExit((id, exitCode) => {
      const parts = splitWorkerPtyId(id)
      if (!parts) return
      useWorkerStore.getState().markProcess(parts.panelId, parts.name, {
        status: exitCode === 0 ? 'stopped' : 'crashed',
        exitCode,
      })
    }),
  ]
  return () => { for (const unsub of unsubs) unsub() }
}
