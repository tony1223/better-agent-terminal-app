import { isCompactSummaryMessage } from './compact-summary'

export interface MessagePreview {
  text: string
  timestamp: number
}

export function compactPreview(content: string): string {
  return content.trim().replace(/\s+/g, ' ').slice(0, 160)
}

/** Archives are chronological within each page. Ignore tool/subagent/internal text. */
export function latestMessagePreview(
  messages: unknown[],
): MessagePreview | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const raw = messages[i]
    if (!raw || typeof raw !== 'object') continue
    const message = raw as Record<string, unknown>
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (
      message.toolName ||
      message.parentToolUseId ||
      typeof message.content !== 'string'
    )
      continue
    if (
      isCompactSummaryMessage(
        message.role,
        message.content,
        message.isCompactSummary,
      )
    )
      continue
    const text = compactPreview(message.content)
    if (!text) continue
    return {
      text,
      timestamp:
        typeof message.timestamp === 'number' &&
        Number.isFinite(message.timestamp)
          ? Math.max(0, message.timestamp)
          : 0,
    }
  }
  return null
}

/** Return a primitive so appending tokens beyond the preview doesn't redraw the row. */
export function sessionPreviewText(
  session:
    | { messages: unknown[]; streamingText: string; isStreaming: boolean }
    | undefined,
  archivedText = '',
  archivedTimestamp = 0,
): string {
  if (!session) return archivedText
  if (session.isStreaming && session.streamingText.trim())
    return compactPreview(session.streamingText)
  const latest = latestMessagePreview(session.messages)
  return latest && latest.timestamp >= archivedTimestamp
    ? latest.text
    : archivedText
}
