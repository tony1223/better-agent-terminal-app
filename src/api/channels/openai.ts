/**
 * OpenAI direct agent channel proxy.
 */

import type { WebSocketClient } from '../websocket-client'

export function createOpenAIChannel(ws: WebSocketClient) {
  return {
    listSessions: (cwd: string) =>
      ws.invoke('openai:list-sessions', cwd),
    getApiKeyStatus: () =>
      ws.invoke<{ hasKey: boolean }>('openai:get-api-key-status'),
    setApiKey: (key: string) =>
      ws.invoke<boolean>('openai:set-api-key', key),
    clearApiKey: () =>
      ws.invoke<boolean>('openai:clear-api-key'),
    compactNow: (sessionId: string) =>
      ws.invoke<boolean>('openai:compact-now', sessionId),
  }
}

export type OpenAIChannel = ReturnType<typeof createOpenAIChannel>
