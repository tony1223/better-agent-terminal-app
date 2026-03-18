/**
 * File System Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createFsChannel(ws: WebSocketClient) {
  return {
    readdir: (dirPath: string) =>
      ws.invoke('fs:readdir', dirPath),
    readFile: (filePath: string) =>
      ws.invoke<string>('fs:readFile', filePath),
    search: (dirPath: string, query: string) =>
      ws.invoke('fs:search', dirPath, query),
  }
}

export type FsChannel = ReturnType<typeof createFsChannel>
