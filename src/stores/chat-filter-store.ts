import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'
import type { ChatItemKind } from '@/utils/classify-chat-item'
import { CHAT_KINDS } from '@/utils/classify-chat-item'

const storage = createMMKV({ id: 'bat-chat-filter' })
const STORAGE_KEY = 'chat-filter-state-v1'

export type FilterMap = Record<ChatItemKind, boolean>

export const DEFAULT_FILTER: FilterMap = {
  you: true,
  message: true,
  tool: true,
  thinking: true,
}

interface StoredState {
  filters: Record<string, FilterMap>
  open: Record<string, boolean>
}

interface ChatFilterState extends StoredState {
  getFilter: (sessionId: string) => FilterMap
  isOpen: (sessionId: string) => boolean
  toggleKind: (sessionId: string, kind: ChatItemKind) => void
  setKind: (sessionId: string, kind: ChatItemKind, on: boolean) => void
  reset: (sessionId: string) => void
  clearSession: (sessionId: string) => void
  setOpen: (sessionId: string, open: boolean) => void
  toggleOpen: (sessionId: string) => void
}

function normalizeFilter(value: unknown): FilterMap {
  const record = value && typeof value === 'object' ? value as Partial<Record<ChatItemKind, unknown>> : {}
  return {
    you: typeof record.you === 'boolean' ? record.you : true,
    message: typeof record.message === 'boolean' ? record.message : true,
    tool: typeof record.tool === 'boolean' ? record.tool : true,
    thinking: typeof record.thinking === 'boolean' ? record.thinking : true,
  }
}

function loadFromStorage(): StoredState {
  try {
    const raw = storage.getString(STORAGE_KEY)
    if (!raw) return { filters: {}, open: {} }
    const parsed = JSON.parse(raw)
    const rawFilters = parsed?.filters && typeof parsed.filters === 'object'
      ? parsed.filters as Record<string, unknown>
      : {}
    const rawOpen = parsed?.open && typeof parsed.open === 'object'
      ? parsed.open as Record<string, unknown>
      : {}
    const filters = Object.fromEntries(
      Object.entries(rawFilters).map(([sessionId, filter]) => [sessionId, normalizeFilter(filter)]),
    )
    const open = Object.fromEntries(
      Object.entries(rawOpen).flatMap(([sessionId, value]) =>
        typeof value === 'boolean' ? [[sessionId, value]] : [],
      ),
    )
    return { filters, open }
  } catch {
    return { filters: {}, open: {} }
  }
}

function persist(state: StoredState) {
  storage.set(STORAGE_KEY, JSON.stringify({ filters: state.filters, open: state.open }))
}

export function isAnyFilterOff(filters: FilterMap): boolean {
  return CHAT_KINDS.some(kind => !filters[kind])
}

export const useChatFilterStore = create<ChatFilterState>((set, get) => {
  const initial = loadFromStorage()
  return {
    filters: initial.filters,
    open: initial.open,

    getFilter: (sessionId) => get().filters[sessionId] ?? DEFAULT_FILTER,
    isOpen: (sessionId) => get().open[sessionId] ?? false,

    toggleKind: (sessionId, kind) => {
      const current = get().getFilter(sessionId)
      get().setKind(sessionId, kind, !current[kind])
    },

    setKind: (sessionId, kind, on) => set(state => {
      const current = state.filters[sessionId] ?? DEFAULT_FILTER
      if (current[kind] === on) return {}
      const filters = { ...state.filters, [sessionId]: { ...current, [kind]: on } }
      persist({ filters, open: state.open })
      return { filters }
    }),

    reset: (sessionId) => set(state => {
      const filters = { ...state.filters }
      delete filters[sessionId]
      persist({ filters, open: state.open })
      return { filters }
    }),

    clearSession: (sessionId) => set(state => {
      const filters = { ...state.filters }
      const open = { ...state.open }
      delete filters[sessionId]
      delete open[sessionId]
      persist({ filters, open })
      return { filters, open }
    }),

    setOpen: (sessionId, openValue) => set(state => {
      const open = { ...state.open, [sessionId]: openValue }
      persist({ filters: state.filters, open })
      return { open }
    }),

    toggleOpen: (sessionId) => {
      get().setOpen(sessionId, !get().isOpen(sessionId))
    },
  }
})
