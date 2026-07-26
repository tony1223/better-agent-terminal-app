/**
 * Claude model preset helpers.
 *
 * The host's supported-models list contains preset ids that wrap a real SDK
 * model plus an auto-compact window, following a naming convention defined
 * by the BAT Desktop host (node-sidecar/src/lib/models.mjs):
 *
 *   <base-model>:auto-compact-<N>k  — base model, compact at N*1000 tokens
 *   <base-model>:<N>m               — base model, no early auto-compact
 *
 * The host only translates a preset back to the real model id on the
 * query-rebuild path, which is taken when `setModel` carries a numeric
 * `autoCompactWindow` — without it the raw preset string reaches the live
 * SDK session and the next message fails with "model may not exist". We
 * parse the suffix instead of hardcoding a preset table so that new models
 * added on the host work without an app update.
 */

const AUTO_COMPACT_SUFFIX = /^(.+):auto-compact-(\d+)k$/
const CONTEXT_ONLY_SUFFIX = /^(.+):(\d+)m$/
// The long-context variants the CLI itself names, e.g. `claude-opus-5[1m]`.
// These are real model ids, not BAT presets, so they are only ever read — never
// rewritten by setModelArgsForClaudeSelection.
const BRACKET_SUFFIX = /^(.+)\[(\d+)([mk])\]$/i

/**
 * Resolve a model picked from the host's supported-models list into the
 * (model, autoCompactWindow) pair to send over `agent:set-model`.
 */
export function setModelArgsForClaudeSelection(model: string): { model: string; autoCompactWindow?: number | null } {
  const autoCompact = AUTO_COMPACT_SUFFIX.exec(model)
  if (autoCompact) {
    // Keep the preset id so the host's session meta retains the preset
    // (display name, context budget); the numeric window forces the host
    // onto the rebuild path where the preset is mapped to the SDK model.
    return { model, autoCompactWindow: Number(autoCompact[2]) * 1000 }
  }
  const contextOnly = CONTEXT_ONLY_SUFFIX.exec(model)
  if (contextOnly) {
    // Send the underlying SDK model id (the host would hand the raw preset
    // to the live session) plus an explicit null window: without it the
    // host keeps a previously-set window, so switching 300k → 1m would keep
    // compacting at 300k while the UI shows 1m. Older hosts ignore null
    // (number-only check), which degrades to the previous behaviour.
    return { model: contextOnly[1], autoCompactWindow: null }
  }
  return { model }
}

/**
 * Context budget a preset id implies, in tokens, or null for a bare model id
 * whose window only the host knows.
 *
 * Used as the fallback when the host's session meta carries no contextWindow —
 * and as the only source for a picker row, which is a plain option we have not
 * selected yet, so no host meta exists for it.
 */
export function contextLimitForModel(model: string | null | undefined): number | null {
  if (!model) return null
  const autoCompact = AUTO_COMPACT_SUFFIX.exec(model)
  if (autoCompact) return Number(autoCompact[2]) * 1000
  const contextOnly = CONTEXT_ONLY_SUFFIX.exec(model)
  if (contextOnly) return Number(contextOnly[2]) * 1_000_000
  const bracketed = BRACKET_SUFFIX.exec(model)
  if (bracketed) {
    return Number(bracketed[2]) * (bracketed[3].toLowerCase() === 'm' ? 1_000_000 : 1000)
  }
  return null
}

/**
 * The plain model id behind a selection, with the preset suffix
 * (`:auto-compact-300k`, `:1m`) or the CLI's `[1m]` tag stripped.
 *
 * The chip pairs this with the context budget, so it reads `claude-opus-5 ·
 * 300k` instead of spelling the same window twice inside one id.
 */
export function baseModelId(model: string | null | undefined): string | null {
  if (!model) return null
  return AUTO_COMPACT_SUFFIX.exec(model)?.[1]
    ?? CONTEXT_ONLY_SUFFIX.exec(model)?.[1]
    ?? BRACKET_SUFFIX.exec(model)?.[1]
    ?? model
}

/**
 * The session config a model id asks for: base model + where auto-compact
 * fires.
 *
 * A bare id is not a third thing — the host re-attaches `[1m]` to it exactly
 * as it does for the `:1m` preset, and leaves early compaction off — so all
 * three spellings of "full window, no early compact" collapse to one key.
 */
function selectionKey(model: string): string {
  const autoCompact = AUTO_COMPACT_SUFFIX.exec(model)
  if (autoCompact) return `${autoCompact[1]}@${Number(autoCompact[2]) * 1000}`
  return `${baseModelId(model)}@full`
}

/**
 * Whether a picker row names the model the session is actually running.
 *
 * String equality isn't enough: picking the `:1m` row sends the host the base
 * id (see setModelArgsForClaudeSelection), so the model it reports back never
 * matches the row it came from — and the list would show nothing selected.
 */
export function isSameModelSelection(
  option: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!option || !current) return false
  return option === current || selectionKey(option) === selectionKey(current)
}

/** Render a token budget the way the model presets name it: 300k, 1M. */
export function formatContextLimit(tokens: number | null | undefined): string | null {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return null
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`
  }
  return `${Math.round(tokens / 1000)}k`
}
