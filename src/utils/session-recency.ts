import type { TerminalInstance } from '@/types'
import type { RecentEntry } from '@/stores/recents-store'

export type SessionSort = 'recent' | 'activity' | 'original'
export function sortSessions(terminals: TerminalInstance[], sort: SessionSort, recents: Record<string, RecentEntry>, lastData: Record<string, number>): TerminalInstance[] {
  if (sort === 'original') return terminals
  const time = (value: number | undefined) => value && Number.isFinite(value) && value > 0 ? value : 0
  return terminals.map((terminal, index) => ({ terminal, index })).sort((a, b) => {
    const opened = time(recents[b.terminal.id]?.lastOpenedAt) - time(recents[a.terminal.id]?.lastOpenedAt)
    const data = time(lastData[b.terminal.id]) - time(lastData[a.terminal.id])
    return (sort === 'recent' ? opened || data : data || opened) || a.index - b.index
  }).map(item => item.terminal)
}
