import {
  baseModelId,
  contextLimitForModel,
  formatContextLimit,
  isSameModelSelection,
  setModelArgsForClaudeSelection,
} from '../src/utils/claude-model-presets'

describe('contextLimitForModel', () => {
  it('reads the auto-compact budget off the preset id', () => {
    expect(contextLimitForModel('claude-sonnet-4-6:auto-compact-300k')).toBe(300000)
  })

  it('reads the context-only budget off the preset id', () => {
    expect(contextLimitForModel('claude-sonnet-4-6:1m')).toBe(1_000_000)
  })

  it('reads the bracketed long-context suffix the CLI uses', () => {
    // Observed on a live host's model chip: `claude-opus-5[1m]`.
    expect(contextLimitForModel('claude-opus-5[1m]')).toBe(1_000_000)
    expect(contextLimitForModel('claude-sonnet-4-6[500k]')).toBe(500000)
  })

  it('leaves a bracketed model id untouched when switching', () => {
    // It is a real model id, not a BAT preset — rewriting it would send the
    // host a model that does not exist.
    expect(setModelArgsForClaudeSelection('claude-opus-5[1m]')).toEqual({
      model: 'claude-opus-5[1m]',
    })
  })

  it('returns null for a bare model id, whose window only the host knows', () => {
    expect(contextLimitForModel('claude-opus-4-8')).toBeNull()
    expect(contextLimitForModel(null)).toBeNull()
  })
})

describe('formatContextLimit', () => {
  it('names budgets the way the presets do', () => {
    expect(formatContextLimit(200000)).toBe('200k')
    expect(formatContextLimit(1_000_000)).toBe('1M')
    expect(formatContextLimit(1_500_000)).toBe('1.5M')
  })

  it('renders nothing for an unknown budget', () => {
    expect(formatContextLimit(0)).toBeNull()
    expect(formatContextLimit(null)).toBeNull()
  })
})

describe('baseModelId', () => {
  it('drops the preset suffix and the CLI long-context tag', () => {
    expect(baseModelId('claude-opus-5:auto-compact-300k')).toBe('claude-opus-5')
    expect(baseModelId('claude-opus-5:1m')).toBe('claude-opus-5')
    expect(baseModelId('claude-opus-5[1m]')).toBe('claude-opus-5')
  })

  it('leaves a plain id alone', () => {
    expect(baseModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001')
    expect(baseModelId(null)).toBeNull()
  })
})

describe('isSameModelSelection', () => {
  it('matches the :1m row against the base id the host reports back', () => {
    // Picking `:1m` sends the host the base model, so without this the picker
    // would come back with no row selected at all.
    expect(isSameModelSelection('claude-opus-5:1m', 'claude-opus-5')).toBe(true)
    expect(isSameModelSelection('claude-opus-5:1m', 'claude-opus-5[1m]')).toBe(true)
  })

  it('keeps auto-compact windows apart', () => {
    expect(isSameModelSelection('claude-opus-5:auto-compact-200k', 'claude-opus-5:auto-compact-300k')).toBe(false)
    // A bare id runs with no early compaction, which is the `:1m` config —
    // not the 300k one.
    expect(isSameModelSelection('claude-opus-5:auto-compact-300k', 'claude-opus-5')).toBe(false)
    expect(isSameModelSelection('claude-opus-5:auto-compact-300k', 'claude-opus-5:auto-compact-300k')).toBe(true)
  })

  it('never matches a different model', () => {
    expect(isSameModelSelection('claude-opus-5:1m', 'claude-sonnet-5')).toBe(false)
    expect(isSameModelSelection('claude-opus-5:1m', null)).toBe(false)
  })
})

describe('setModelArgsForClaudeSelection', () => {
  it('keeps a context-only preset aligned: base model out, budget still readable from the id', () => {
    const selection = 'claude-sonnet-4-6:1m'
    // The host is sent the base model, so meta.model comes back without the
    // suffix — the budget has to survive via the picked id, not the response.
    expect(setModelArgsForClaudeSelection(selection)).toEqual({
      model: 'claude-sonnet-4-6',
      autoCompactWindow: null,
    })
    expect(formatContextLimit(contextLimitForModel(selection))).toBe('1M')
  })

  it('keeps the preset id for auto-compact so the budget round-trips', () => {
    expect(setModelArgsForClaudeSelection('claude-sonnet-4-6:auto-compact-300k')).toEqual({
      model: 'claude-sonnet-4-6:auto-compact-300k',
      autoCompactWindow: 300000,
    })
  })
})
