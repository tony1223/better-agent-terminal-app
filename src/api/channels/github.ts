/**
 * GitHub Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createGithubChannel(ws: WebSocketClient) {
  return {
    checkCli: () => ws.invoke<boolean>('github:check-cli'),
    prList: (cwd: string) => ws.invoke('github:pr-list', cwd),
    issueList: (cwd: string) => ws.invoke('github:issue-list', cwd),
    prView: (cwd: string, number: number) => ws.invoke('github:pr-view', cwd, number),
    issueView: (cwd: string, number: number) => ws.invoke('github:issue-view', cwd, number),
    prComment: (cwd: string, number: number, body: string) => ws.invoke('github:pr-comment', cwd, number, body),
    issueComment: (cwd: string, number: number, body: string) => ws.invoke('github:issue-comment', cwd, number, body),
  }
}

export type GithubChannel = ReturnType<typeof createGithubChannel>
