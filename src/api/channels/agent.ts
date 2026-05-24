/**
 * Agent metadata channel.
 */

import type { WebSocketClient } from '../websocket-client'
import type { AgentPreset } from '@/types'

export function createAgentChannel(ws: WebSocketClient) {
  return {
    getSupportedSessionTypes: () =>
      ws.invokeParams<string[]>('agent:get-supported-session-types', {}, []),
    listPresets: () =>
      ws.invokeParams<Array<string | Partial<AgentPreset> & { id: string }>>('agent:list-presets', {}, []),
  }
}

export type AgentChannel = ReturnType<typeof createAgentChannel>
