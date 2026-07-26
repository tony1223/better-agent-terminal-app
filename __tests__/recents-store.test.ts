import { rankRecents, recencyScore, useRecentsStore, type RecentEntry } from '../src/stores/recents-store'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function entry(id: string, count: number, daysAgo: number): RecentEntry {
  return { id, count, lastOpenedAt: NOW - daysAgo * DAY }
}

describe('recencyScore', () => {
  test('halves every week', () => {
    const fresh = recencyScore(entry('a', 8, 0), NOW)
    const weekOld = recencyScore(entry('a', 8, 7), NOW)
    expect(weekOld).toBeCloseTo(fresh / 2, 5)
  })
})

describe('rankRecents', () => {
  const ids = ['a', 'b', 'c']

  test('recent-and-repeated beats stale-but-frequent', () => {
    const entries = {
      // Lived in last month, untouched since.
      a: entry('a', 30, 30),
      // Opened a couple of times today.
      b: entry('b', 2, 0),
    }
    expect(rankRecents(entries, ids, NOW, 5)).toEqual(['b', 'a'])
  })

  test('repeated use beats a single accidental open on the same day', () => {
    const entries = { a: entry('a', 1, 0), b: entry('b', 4, 0) }
    expect(rankRecents(entries, ids, NOW, 5)).toEqual(['b', 'a'])
  })

  test('drops ids that no longer exist', () => {
    // A deleted workspace lingers in storage — nothing tells us it's gone — and
    // must not surface as a chip that opens nothing.
    const entries = { a: entry('a', 5, 0), zz: entry('zz', 99, 0) }
    expect(rankRecents(entries, ids, NOW, 5)).toEqual(['a'])
  })

  test('respects the limit', () => {
    const entries = {
      a: entry('a', 1, 0),
      b: entry('b', 2, 0),
      c: entry('c', 3, 0),
    }
    expect(rankRecents(entries, ids, NOW, 2)).toEqual(['c', 'b'])
  })

  test('no history means no ranking, not an arbitrary one', () => {
    expect(rankRecents({}, ids, NOW, 5)).toEqual([])
  })
})

describe('useRecentsStore', () => {
  beforeEach(() => {
    useRecentsStore.setState({ workspaces: {}, sessions: {} })
  })

  test('touch accumulates a count and moves the timestamp', () => {
    const { touchWorkspace } = useRecentsStore.getState()
    touchWorkspace('w1')
    touchWorkspace('w1')
    expect(useRecentsStore.getState().workspaces.w1.count).toBe(2)
    expect(useRecentsStore.getState().workspaces.w1.lastOpenedAt).toBeGreaterThan(0)
  })

  test('workspaces and sessions are tracked separately', () => {
    useRecentsStore.getState().touchWorkspace('shared-id')
    expect(useRecentsStore.getState().sessions['shared-id']).toBeUndefined()
  })

  test('forgetting a closed session removes it', () => {
    const store = useRecentsStore.getState()
    store.touchSession('s1')
    store.forgetSession('s1')
    expect(useRecentsStore.getState().sessions.s1).toBeUndefined()
  })
})
