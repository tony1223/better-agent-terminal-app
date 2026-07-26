/**
 * Reading an answered AskUserQuestion back out of the transcript.
 *
 * The picks are only ever reported to the model inside the tool result —
 * `Your questions have been answered: "<question>"="<answer>", …` — and the
 * stored `tool_use` input still holds the *unanswered* questions. Parsing the
 * result is therefore the only way to show what was chosen, and the only way
 * that survives a session replayed from history.
 *
 * Mirrors AskUserQuestion.helpers.ts in the desktop renderer.
 */

import type { AskUserQuestion } from '@/types'

export interface AskUserExchange extends AskUserQuestion {
  /** The raw answer string, or null while the tool is still pending. */
  answer: string | null
  /** Answer split into labels — multi-select joins its picks with ', '. */
  chosen: string[]
}

function normalizeOption(value: unknown, index: number): AskUserQuestion['options'][number] {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : `Option ${index + 1}`
  return {
    label,
    description: typeof record.description === 'string' ? record.description.trim() : '',
  }
}

function normalizeQuestion(value: unknown, index: number): AskUserQuestion | null {
  // A bare string is a question with no options to choose from.
  if (typeof value === 'string') {
    const question = value.trim()
    return question ? { header: `Q${index + 1}`, question, options: [], multiSelect: false } : null
  }
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const question = typeof record.question === 'string' ? record.question.trim() : ''
  if (!question) return null

  return {
    header: typeof record.header === 'string' && record.header.trim()
      ? record.header.trim()
      : `Q${index + 1}`,
    question,
    options: (Array.isArray(record.options) ? record.options : []).map(normalizeOption),
    multiSelect: record.multiSelect === true,
  }
}

export function normalizeAskUserQuestions(input: Record<string, unknown> | undefined): AskUserQuestion[] {
  const raw = Array.isArray(input?.questions) ? input.questions : []
  return raw
    .map(normalizeQuestion)
    .filter((question): question is AskUserQuestion => question !== null)
}

export function parseAskUserAnswers(resultText: string): Map<string, string> {
  const answers = new Map<string, string>()
  // Both sides are quoted, so anchoring on the `=` between them is enough to
  // keep a question containing a comma from splitting into two pairs.
  for (const match of resultText.matchAll(/"([^"]*)"\s*=\s*"([^"]*)"/g)) {
    answers.set(match[1], match[2])
  }
  return answers
}

/**
 * Pair each question with what the user picked. Returns [] when the input
 * carries no questions — the caller then falls back to the raw tool card.
 */
export function askUserExchange(
  input: Record<string, unknown> | undefined,
  resultText: string | undefined,
): AskUserExchange[] {
  const questions = normalizeAskUserQuestions(input)
  if (questions.length === 0) return []

  const answers = parseAskUserAnswers(resultText ?? '')
  return questions.map((question) => {
    // The SDK keys answers by question text; older payloads used the header.
    const answer = answers.get(question.question) ?? answers.get(question.header) ?? null
    return {
      ...question,
      answer,
      chosen: answer ? answer.split(',').map(part => part.trim()).filter(Boolean) : [],
    }
  })
}

/** One-line header text for the collapsed tool row. */
export function summarizeAskUserInput(input: Record<string, unknown> | undefined): string {
  return normalizeAskUserQuestions(input).map(question => question.header).join(', ')
}
