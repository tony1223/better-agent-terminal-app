/**
 * File System Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createFsChannel(ws: WebSocketClient) {
  return {
    readdir: (dirPath: string) =>
      ws.invoke('fs:readdir', dirPath),
    readFile: (filePath: string) =>
      ws.invoke<{ content?: string; error?: string; size?: number }>('fs:readFile', filePath),
    search: (dirPath: string, query: string) =>
      ws.invoke('fs:search', dirPath, query),
    watch: (dirPath: string) =>
      ws.invoke('fs:watch', dirPath),
    unwatch: (dirPath: string) =>
      ws.invoke('fs:unwatch', dirPath),
    onChanged: (cb: (event: { path: string; type: string }) => void) =>
      ws.on('fs:changed', cb as (...args: unknown[]) => void),
  }
}

export type FsChannel = ReturnType<typeof createFsChannel>
