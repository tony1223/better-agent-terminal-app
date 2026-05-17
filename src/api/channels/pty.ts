/**
 * PTY Channel Proxy
 * Reference: BAT Desktop electron/preload.ts (pty section)
 */

import type { WebSocketClient } from '../websocket-client'
import type {
  CreatePtyOptions,
  SetViewportModeOptions,
  TerminalViewportMode,
  TerminalViewportSource,
  TerminalViewportState,
} from '@/types'

export function createPtyChannel(ws: WebSocketClient) {
  return {
    create: (options: CreatePtyOptions) =>
      ws.invoke<string>('pty:create', options),
    write: (id: string, data: string) =>
      ws.invoke<void>('pty:write', id, data),
    readBuffer: (id: string) =>
      ws.invoke<string>('pty:read-buffer', id),
    resize: (id: string, cols: number, rows: number) =>
      ws.invoke<void>('pty:resize', id, cols, rows),
    getViewportState: (id: string) =>
      ws.invoke<TerminalViewportState>('pty:get-viewport-state', id),
    setViewportMode: (id: string, mode: TerminalViewportMode, options?: SetViewportModeOptions) =>
      ws.invoke<TerminalViewportState>('pty:set-viewport-mode', id, mode, options),
    setViewportSize: (id: string, cols: number, rows: number, source: TerminalViewportSource) =>
      ws.invoke<TerminalViewportState>('pty:set-viewport-size', id, cols, rows, source),
    kill: (id: string) =>
      ws.invoke<boolean>('pty:kill', id),
    restart: (id: string, cwd: string, shell?: string) =>
      ws.invoke<boolean>('pty:restart', id, cwd, shell),
    getCwd: (id: string) =>
      ws.invoke<string | null>('pty:get-cwd', id),

    // Events
    onOutput: (cb: (id: string, data: string) => void) =>
      ws.on('pty:output', cb as (...args: unknown[]) => void),
    onExit: (cb: (id: string, exitCode: number) => void) =>
      ws.on('pty:exit', cb as (...args: unknown[]) => void),
    onViewportState: (cb: (id: string, state: TerminalViewportState) => void) =>
      ws.on('pty:viewport-state', cb as (...args: unknown[]) => void),
  }
}

export type PtyChannel = ReturnType<typeof createPtyChannel>
