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
    home: () =>
      ws.invoke<string>('fs:home'),
    listDirs: (dirPath: string) =>
      ws.invoke('fs:list-dirs', dirPath),
    mkdir: (dirPath: string) =>
      ws.invoke('fs:mkdir', dirPath),
    quickLocations: () =>
      ws.invoke('fs:quick-locations'),
    readImageAsDataUrl: (filePath: string) =>
      ws.invoke<string>('image:read-as-data-url', filePath),
    onChanged: (cb: (event: { path: string; type: string }) => void) =>
      ws.on('fs:changed', cb as (...args: unknown[]) => void),
  }
}

export type FsChannel = ReturnType<typeof createFsChannel>
