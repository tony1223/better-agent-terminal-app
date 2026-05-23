import type { ClaudeMessage, ClaudeToolCall } from '@/types'
import { isToolCall } from '@/types'

export type ChatItemKind = 'you' | 'message' | 'tool' | 'thinking'

export const CHAT_KINDS: ChatItemKind[] = ['you', 'message', 'tool', 'thinking']

export function classifyChatItem(item: ClaudeMessage | ClaudeToolCall): ChatItemKind | null {
  if (isToolCall(item)) return 'tool'
  if (item.role === 'user') return 'you'
  if (item.role === 'assistant') {
    if (item.thinking && !item.content.trim()) return 'thinking'
    return 'message'
  }
  return null
}

export const KIND_LABEL: Record<ChatItemKind, string> = {
  you: 'You',
  message: 'Message',
  tool: 'Tool',
  thinking: 'Thinking',
}

export const KIND_LABEL_PLURAL: Record<ChatItemKind, string> = {
  you: 'you messages',
  message: 'messages',
  tool: 'tool calls',
  thinking: 'thinking blocks',
}
