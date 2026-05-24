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
      ws.invokeParams<string>('pty:create', { options }, [options]),
    write: (id: string, data: string) =>
      ws.invokeParams<void>('pty:write', { id, data }, [id, data]),
    readBuffer: (id: string) =>
      ws.invokeParams<string>('pty:read-buffer', { id }, [id]),
    resize: (id: string, cols: number, rows: number) =>
      ws.invokeParams<void>('pty:resize', { id, cols, rows }, [id, cols, rows]),
    getViewportState: (id: string) =>
      ws.invokeParams<TerminalViewportState>('pty:get-viewport-state', { id }, [id]),
    setViewportMode: (id: string, mode: TerminalViewportMode, options?: SetViewportModeOptions) =>
      ws.invokeParams<TerminalViewportState>('pty:set-viewport-mode', { id, mode, options }, [id, mode, options]),
    setViewportSize: (id: string, cols: number, rows: number, source: TerminalViewportSource) =>
      ws.invokeParams<TerminalViewportState>('pty:set-viewport-size', { id, cols, rows, source }, [id, cols, rows, source]),
    kill: (id: string) =>
      ws.invokeParams<boolean>('pty:kill', { id }, [id]),
    restart: (id: string, cwd: string, shell?: string) =>
      ws.invokeParams<boolean>('pty:restart', { id, cwd, shell }, [id, cwd, shell]),
    getCwd: (id: string) =>
      ws.invokeParams<string | null>('pty:get-cwd', { id }, [id]),

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
