import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useClaudeStore } from '@/stores/claude-store'
import { useRecentsStore } from '@/stores/recents-store'
import { sortSessions, type SessionSort } from '@/utils/session-recency'
import type { TerminalInstance } from '@/types'

export function useSessionOrder(terminals: TerminalInstance[], sort: SessionSort) {
  const recents = useRecentsStore(s => s.sessions)
  const lastData = useClaudeStore(useShallow(s => Object.fromEntries(terminals.map(item => [item.id, s.sessions[item.id]?.lastDataAt ?? 0]))))
  return useMemo(() => sortSessions(terminals, sort, recents, lastData), [terminals, sort, recents, lastData])
}
