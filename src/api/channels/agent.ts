/**
 * Agent metadata channel.
 */

import type { WebSocketClient } from '../websocket-client'

export function createAgentChannel(ws: WebSocketClient) {
  return {
    getSupportedSessionTypes: () =>
      ws.invokeParams<string[]>('agent:get-supported-session-types', {}, []),
    listPresets: () =>
      ws.invokeParams<string[]>('agent:list-presets', {}, []),
  }
}

export type AgentChannel = ReturnType<typeof createAgentChannel>
