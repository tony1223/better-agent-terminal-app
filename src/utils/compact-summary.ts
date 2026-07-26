/**
 * Auto-compact continuation messages.
 *
 * When the agent runs out of context the SDK summarises the conversation so
 * far and feeds that summary back as the *next user message* — that is how the
 * session keeps going instead of starting over. It is a real prompt, just not
 * one the user typed, so rendering it as a normal chat bubble reads as if the
 * app dumped a wall of text on their behalf.
 *
 * The transcript flags it (`isCompactSummary`), but the host's history payload
 * only carries role + content, so fall back to the preamble the SDK writes.
 * A host that does pass the flag through wins over the text match.
 */

const COMPACT_PREAMBLE = /^this session is being continued from a previous conversation/i

export function isCompactSummaryMessage(
  role: string,
  content: string,
  hostFlag?: unknown,
): boolean {
  if (hostFlag === true) return true
  if (role !== 'user') return false
  return COMPACT_PREAMBLE.test(content.trim())
}
