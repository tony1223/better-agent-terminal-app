/**
 * Worker (Procfile) Channel Proxy
 * Reference: BAT Desktop src-tauri/src/remote_server.rs (`worker:*` arms) and
 * src-tauri/src/commands/worker_buffer.rs.
 *
 * Seven channels, no events: process output arrives on `pty:output` /
 * `pty:exit` under the composite id `${panelId}__w__${name}` (see utils/worker).
 * There is no status query either — `pty.getCwd(ptyId)` answering non-null is
 * how a client learns a process is alive, and it doubles as the interest
 * registration a profile context needs before it will forward that PTY's
 * output to us.
 */

import type { ChannelTransport as WebSocketClient } from '../websocket-client'
import type { WorkerProcfileEntry } from '@/types'

export interface WorkerProcessStartOptions {
  panelId: string
  name: string
  command: string
  cwd: string
  /** Leave unset: the host resolves its own default shell. */
  shell?: string
  customEnv?: Record<string, string>
}

export function createWorkerChannel(ws: WebSocketClient) {
  return {
    bufferInit: (panelId: string) =>
      ws.invokeParams<boolean>('worker:buffer-init', { panelId }, [panelId]),
    /** `lines` is newline-terminated NDJSON of WorkerLogEntry. */
    bufferAppend: (panelId: string, lines: string) =>
      ws.invokeParams<boolean>('worker:buffer-append', { panelId, lines }, [panelId, lines]),
    bufferReadAll: (panelId: string) =>
      ws.invokeParams<string>('worker:buffer-read-all', { panelId }, [panelId]),
    bufferClear: (panelId: string) =>
      ws.invokeParams<boolean>('worker:buffer-clear', { panelId }, [panelId]),
    loadProcfile: (filePath: string) =>
      ws.invokeParams<WorkerProcfileEntry[]>('worker:procfile-load', { filePath }, [filePath]),
    /** Resolves with the process's pty id. */
    startProcess: (options: WorkerProcessStartOptions) =>
      ws.invokeParams<string>('worker:procfile-start', { options }, [options]),
    stopProcess: (panelId: string, name: string) =>
      ws.invokeParams<boolean>('worker:procfile-stop', { panelId, name }, [panelId, name]),
  }
}

export type WorkerChannel = ReturnType<typeof createWorkerChannel>
