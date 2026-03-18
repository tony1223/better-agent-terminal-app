/**
 * PTY Channel Proxy
 * Reference: BAT Desktop electron/preload.ts (pty section)
 */

import type { WebSocketClient } from '../websocket-client'
import type { CreatePtyOptions } from '@/types'

export function createPtyChannel(ws: WebSocketClient) {
  return {
    create: (options: CreatePtyOptions) =>
      ws.invoke<boolean>('pty:create', options),
    write: (id: string, data: string) =>
      ws.invoke<void>('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ws.invoke<void>('pty:resize', id, cols, rows),
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
  }
}

export type PtyChannel = ReturnType<typeof createPtyChannel>
