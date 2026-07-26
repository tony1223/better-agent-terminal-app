import {
  askUserExchange,
  normalizeAskUserQuestions,
  parseAskUserAnswers,
  summarizeAskUserInput,
} from '../src/utils/ask-user-answers'

// The exchange that prompted this view, verbatim.
const ROLLOUT_INPUT = {
  questions: [{
    header: 'Rollout',
    multiSelect: false,
    question: '1.0.34 (versionCode 41) 要怎麼上 production？',
    options: [
      { label: '先跑 dry run（推薦）', description: '印出將要送出的 release 內容然後放棄 edit。' },
      { label: '20% 分階段發布', description: 'status=inProgress、userFraction=0.2。' },
      { label: '100% 全量發布', description: 'status=completed，推給所有正式版使用者。' },
    ],
  }],
}

const ROLLOUT_RESULT =
  'Your questions have been answered: "1.0.34 (versionCode 41) 要怎麼上 production？"="100% 全量發布". '
  + 'You can now continue with these answers in mind.'

describe('pulling the answers back out of the result', () => {
  it('pairs the pick with its question', () => {
    const [item] = askUserExchange(ROLLOUT_INPUT, ROLLOUT_RESULT)
    expect(item.header).toBe('Rollout')
    expect(item.chosen).toEqual(['100% 全量發布'])
    // The pick must match an option label exactly, or the row loses its tick.
    expect(item.options.some(option => option.label === item.chosen[0])).toBe(true)
  })

  it('reports a pending tool instead of inventing an answer', () => {
    const [item] = askUserExchange(ROLLOUT_INPUT, undefined)
    expect(item.answer).toBeNull()
    expect(item.chosen).toEqual([])
  })

  it('splits a multi-select answer back into labels', () => {
    const input = {
      questions: [{
        header: 'Features',
        question: 'Which ones?',
        multiSelect: true,
        options: [{ label: 'Auth' }, { label: 'Billing' }, { label: 'Search' }],
      }],
    }
    const [item] = askUserExchange(input, 'answered: "Which ones?"="Auth, Search".')
    expect(item.chosen).toEqual(['Auth', 'Search'])
  })

  it('keeps a comma inside a question from splitting the pairs', () => {
    const answers = parseAskUserAnswers('"Ship it, or wait?"="Ship it", "Track"="beta".')
    expect(answers.get('Ship it, or wait?')).toBe('Ship it')
    expect(answers.get('Track')).toBe('beta')
  })

  it('carries an "Other" answer through even though it matches no option', () => {
    const [item] = askUserExchange(ROLLOUT_INPUT, ROLLOUT_RESULT.replace('100% 全量發布', '先問老闆'))
    expect(item.chosen).toEqual(['先問老闆'])
    expect(item.options.some(option => option.label === '先問老闆')).toBe(false)
  })
})

describe('normalising whatever the tool input holds', () => {
  it('accepts a bare string as a question with no options', () => {
    const [item] = normalizeAskUserQuestions({ questions: ['Proceed?'] })
    expect(item).toMatchObject({ header: 'Q1', question: 'Proceed?', options: [], multiSelect: false })
  })

  it('drops entries that carry no question', () => {
    expect(normalizeAskUserQuestions({ questions: [null, '', { header: 'X' }, 42] })).toEqual([])
    expect(normalizeAskUserQuestions({})).toEqual([])
    expect(normalizeAskUserQuestions(undefined)).toEqual([])
  })

  it('names the collapsed row after the headers', () => {
    expect(summarizeAskUserInput(ROLLOUT_INPUT)).toBe('Rollout')
    expect(summarizeAskUserInput({
      questions: [{ header: 'Rollout', question: 'a' }, { header: 'Track', question: 'b' }],
    })).toBe('Rollout, Track')
  })
})
