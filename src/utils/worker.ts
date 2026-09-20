/**
 * Procfile worker panels, the parts that have to agree with the desktop.
 *
 * A worker panel is not its own kind of session on the host. It is an ordinary
 * terminal record with `procfilePath` set, and the host never spawns a PTY under
 * the panel's own id. Each Procfile entry runs as a separate PTY whose id is
 * `${panelId}__w__${name}`, and their output rides the ordinary `pty:output` /
 * `pty:exit` events — there is no `worker:*` event at all. The host also keeps
 * one shared log per panel (`worker:buffer-*`), as newline-delimited JSON, that
 * every client reads on attach and appends its own banner lines to.
 *
 * Everything below is ported from BAT Desktop renderer/src/components/
 * WorkerPanel.tsx and must stay byte-compatible with it: the buffer is shared
 * between the desktop window and this phone, so a line one writes has to parse
 * on the other.
 */

import type { TerminalInstance } from '@/types'
import type { SessionActivity } from '@/utils/session-status'

export const WORKER_PTY_SEPARATOR = '__w__'

/** Same palette as the desktop, assigned by position in the Procfile. */
export const WORKER_COLORS = [
  '#61afef', '#98c379', '#e5c07b', '#c678dd',
  '#e06c75', '#56b6c2', '#d19a66', '#be5046',
]

export const PROCFILE_PATTERN = /^Procfile(?:\..+)?$/i

export function isProcfileName(name: string): boolean {
  return PROCFILE_PATTERN.test(name)
}

export type WorkerProcessStatus = 'starting' | 'running' | 'stopped' | 'crashed'

export interface WorkerProcess {
  name: string
  command: string
  ptyId: string
  color: string
  status: WorkerProcessStatus
  exitCode?: number
}

/** One persisted log line. `color` is '' when the host wrote it. */
export interface WorkerLogEntry {
  name: string
  color: string
  data: string
}

/** Pre-formatted banner text, shown as-is and never filtered by process. */
export const WORKER_HEADER_NAME = '__header__'

export function workerPtyId(panelId: string, name: string): string {
  return `${panelId}${WORKER_PTY_SEPARATOR}${name}`
}

/** The routing rule for every pty event: if it splits, it is worker output. */
export function splitWorkerPtyId(id: string): { panelId: string; name: string } | null {
  const at = id.indexOf(WORKER_PTY_SEPARATOR)
  if (at <= 0) return null
  const name = id.slice(at + WORKER_PTY_SEPARATOR.length)
  if (!name) return null
  return { panelId: id.slice(0, at), name }
}

export function parseWorkerBuffer(raw: string): WorkerLogEntry[] {
  if (!raw.trim()) return []
  const entries: WorkerLogEntry[] = []
  for (const line of raw.trim().split('\n')) {
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as Partial<WorkerLogEntry>
      if (typeof parsed.name === 'string' && typeof parsed.color === 'string' && typeof parsed.data === 'string') {
        entries.push({ name: parsed.name, color: parsed.color, data: parsed.data })
      }
    } catch {
      // A torn line from a concurrent writer; later output still appends.
    }
  }
  return entries
}

export function serializeWorkerEntries(entries: WorkerLogEntry[]): string {
  return entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255]
}

export function ansiColor(hex: string, text: string): string {
  const [r, g, b] = hexToRgb(hex)
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

/**
 * Put the process name in front of every line of a chunk.
 *
 * Chunks are not line-aligned, so whether this chunk starts a new line depends
 * on how the previous chunk for the same process ended — that is the
 * `wasMidLine` / `midLine` pair. A bare `\r` (progress bars) re-prefixes, since
 * the cursor just went back to column 0.
 */
export function prefixWorkerChunk(data: string, prefix: string, wasMidLine: boolean): { output: string; midLine: boolean } {
  let output = ''
  let atLineStart = !wasMidLine

  for (let index = 0; index < data.length; index++) {
    const char = data[index]
    const next = data[index + 1]

    if (char === '\r' && next === '\n') {
      output += '\r\n'
      index++
      atLineStart = true
      continue
    }

    if (char === '\n') {
      output += '\n'
      atLineStart = true
      continue
    }

    if (char === '\r') {
      output += '\r' + prefix
      atLineStart = false
      continue
    }

    if (atLineStart) {
      output += prefix
      atLineStart = false
    }
    output += char
  }

  return { output, midLine: !atLineStart }
}

export function workerLinePrefix(name: string, color: string, nameWidth: number): string {
  return ansiColor(color, name.padEnd(nameWidth)) + '\x1b[90m | \x1b[0m'
}

/** The desktop splits on `/` only, which leaves Windows paths whole; both here. */
export function procfileBasename(procfilePath: string): string {
  return procfilePath.split(/[\\/]/).pop() || 'Procfile'
}

/** Processes run from the Procfile's directory, not the panel's cwd. */
export function procfileDirectory(procfilePath: string, fallbackCwd: string): string {
  const normalized = procfilePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return fallbackCwd
  return procfilePath.slice(0, lastSlash)
}

export function buildWorkerHeader(procfilePath: string, processCount: number): string {
  return ansiColor('#888', `Worker: ${procfileBasename(procfilePath)} (${processCount} processes)\r\n`)
    + ansiColor('#555', '─'.repeat(60) + '\r\n')
}

/**
 * The same env the desktop hands a worker started inside a worktree, so a
 * Procfile that reads BAT_PORT_OFFSET gets the same port whichever client
 * started it.
 */
export function worktreeProcessEnv(processCwd: string): Record<string, string> {
  const m = /\.bat-worktrees[/\\]([0-9a-f]+)(?:[/\\]|$)/.exec(processCwd)
  if (!m) return {}
  const id = m[1]
  const index = parseInt(id.slice(0, 6), 16) % 100
  return { BAT_WORKTREE_ID: id, BAT_WORKTREE_INDEX: String(index), BAT_PORT_OFFSET: String(index * 10) }
}

export function isWorkerSession(terminal: Pick<TerminalInstance, 'procfilePath'>): boolean {
  return !!terminal.procfilePath
}

/**
 * What a session row says about a worker panel. Alive means at least one
 * process is up; the roster line next to the badge carries the detail.
 */
export function deriveWorkerActivity(processes: WorkerProcess[] | undefined): SessionActivity {
  if (!processes) return 'idle'
  return processes.some(p => p.status === 'running' || p.status === 'starting') ? 'idle' : 'stopped'
}
