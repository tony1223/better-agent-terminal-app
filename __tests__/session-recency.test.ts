import { sortSessions } from '../src/utils/session-recency'
import type { TerminalInstance } from '../src/types'

const terminals = ['old', 'running', 'mine', 'new'].map(id => ({ id } as TerminalInstance))
const recents = { old: { id: 'old', count: 200, lastOpenedAt: 100 }, mine: { id: 'mine', count: 1, lastOpenedAt: 500 } }
const output = { old: 0, running: 1000, mine: 200, new: 300 }
test('recently opened favours the sessions I used over noisy unvisited sessions', () => {
  expect(sortSessions(terminals, 'recent', recents, output).map(item => item.id)).toEqual(['mine', 'old', 'running', 'new'])
})
test('latest output is a distinct host-based ordering', () => {
  expect(sortSessions(terminals, 'activity', recents, output).map(item => item.id)).toEqual(['running', 'new', 'mine', 'old'])
})
test('unknown times are stable and sorting never mutates workspace order', () => {
  expect(sortSessions(terminals, 'recent', {}, {})).toEqual(terminals)
  expect(sortSessions(terminals, 'original', recents, output)).toBe(terminals)
  sortSessions(terminals, 'activity', recents, output)
  expect(terminals.map(item => item.id)).toEqual(['old', 'running', 'mine', 'new'])
})
