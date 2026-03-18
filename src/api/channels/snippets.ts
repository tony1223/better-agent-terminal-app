/**
 * Snippets Channel Proxy
 */

import type { WebSocketClient } from '../websocket-client'

export function createSnippetsChannel(ws: WebSocketClient) {
  return {
    getAll: () => ws.invoke('snippet:getAll'),
    getById: (id: string) => ws.invoke('snippet:getById', id),
    create: (input: unknown) => ws.invoke('snippet:create', input),
    update: (id: string, updates: unknown) => ws.invoke('snippet:update', id, updates),
    delete: (id: string) => ws.invoke('snippet:delete', id),
    toggleFavorite: (id: string) => ws.invoke('snippet:toggleFavorite', id),
    search: (query: string) => ws.invoke('snippet:search', query),
    getCategories: () => ws.invoke('snippet:getCategories'),
    getFavorites: () => ws.invoke('snippet:getFavorites'),
  }
}

export type SnippetsChannel = ReturnType<typeof createSnippetsChannel>
