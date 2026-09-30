import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'
import type { useConnectionStore } from './connection-store'

const storage = createMMKV({ id: 'bat-agent-preferences' })
const KEY = 'effort-v1'
const allowed = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])
export function agentPreferenceScope(
  connection: ReturnType<typeof useConnectionStore.getState>,
  profileId?: string | null,
) {
  return `${
    connection.client?.profileCacheKey ??
    `${connection.host}:${connection.port}`
  }/${
    connection.profileViewKey ??
    profileId ??
    connection.selectedProfileId ??
    'default'
  }`
}
const family = (preset?: string) =>
  preset?.startsWith('codex-agent')
    ? 'codex'
    : preset === 'openai-agent'
    ? 'openai'
    : 'claude'
export function resolveEffort(...values: unknown[]): string {
  return (
    values.find(
      (value): value is string =>
        typeof value === 'string' && allowed.has(value),
    ) ?? 'high'
  )
}
function read(): Record<string, string> {
  try {
    return Object.fromEntries(
      Object.entries(JSON.parse(storage.getString(KEY) ?? '{}')).filter(
        ([, value]) => typeof value === 'string' && allowed.has(value),
      ),
    ) as Record<string, string>
  } catch {
    return {}
  }
}
interface Preferences {
  efforts: Record<string, string>
  remember: (
    scope: string,
    sessionId: string,
    preset: string | undefined,
    effort: string,
  ) => void
  sessionEffort: (scope: string, sessionId: string) => string | undefined
  defaultEffort: (scope: string, preset?: string) => string | undefined
}
export const useAgentPreferencesStore = create<Preferences>((set, get) => ({
  efforts: read(),
  remember: (scope, sessionId, preset, effort) => {
    if (!allowed.has(effort)) return
    const efforts = {
      ...get().efforts,
      [JSON.stringify([scope, 'session', sessionId])]: effort,
      [JSON.stringify([scope, 'default', family(preset)])]: effort,
    }
    storage.set(KEY, JSON.stringify(efforts))
    set({ efforts })
  },
  sessionEffort: (scope, id) =>
    get().efforts[JSON.stringify([scope, 'session', id])],
  defaultEffort: (scope, preset) =>
    get().efforts[JSON.stringify([scope, 'default', family(preset)])],
}))
