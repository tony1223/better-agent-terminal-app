import type { ClaudeMessage, ClaudeToolCall } from '@/types'
import { classifyChatItem, type ChatItemKind } from './classify-chat-item'

export type HiddenKindCounts = Partial<Record<ChatItemKind, number>>
export type ListEntry =
  | { kind: 'item'; data: ClaudeMessage | ClaudeToolCall }
  | { kind: 'placeholder'; counts: HiddenKindCounts; id: string }

/** One placeholder per uninterrupted hidden run, even when its kinds alternate. */
export function filterChatEntries(
  messages: (ClaudeMessage | ClaudeToolCall)[],
  filters: Record<ChatItemKind, boolean>,
): ListEntry[] {
  const entries: ListEntry[] = []
  for (const item of messages) {
    const kind = classifyChatItem(item)
    if (kind && !filters[kind]) {
      const previous = entries[entries.length - 1]
      if (previous?.kind === 'placeholder') {
        previous.counts[kind] = (previous.counts[kind] ?? 0) + 1
      } else {
        entries.push({ kind: 'placeholder', counts: { [kind]: 1 }, id: `ph-${item.id}` })
      }
    } else {
      entries.push({ kind: 'item', data: item })
    }
  }
  return entries
}
