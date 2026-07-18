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

const AUTO_COMPACT_SUFFIX = /^.+:auto-compact-(\d+)k$/
const CONTEXT_ONLY_SUFFIX = /^(.+):\d+m$/

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
    return { model, autoCompactWindow: Number(autoCompact[1]) * 1000 }
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
