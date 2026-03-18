/**
 * Git Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createGitChannel(ws: WebSocketClient) {
  return {
    branch: (cwd: string) =>
      ws.invoke<string>('git:branch', cwd),
    log: (cwd: string, count?: number) =>
      ws.invoke('git:log', cwd, count),
    diff: (cwd: string, commitHash?: string, filePath?: string) =>
      ws.invoke<string>('git:diff', cwd, commitHash, filePath),
    diffFiles: (cwd: string, commitHash?: string) =>
      ws.invoke('git:diff-files', cwd, commitHash),
    status: (cwd: string) =>
      ws.invoke('git:status', cwd),
    getGithubUrl: (folderPath: string) =>
      ws.invoke<string | null>('git:get-github-url', folderPath),
  }
}

export type GitChannel = ReturnType<typeof createGitChannel>
