import { filterChatEntries } from '../src/utils/filter-chat-entries'
import { DEFAULT_FILTER } from '../src/stores/chat-filter-store'
import type { ClaudeMessage, ClaudeToolCall } from '../src/types'

const tool = (id: string): ClaudeToolCall => ({ id, sessionId: 's', toolName: 'Bash', input: {}, status: 'completed', timestamp: 1 })
const thinking = (id: string): ClaudeMessage => ({ id, sessionId: 's', role: 'assistant', content: '', thinking: 'working', timestamp: 1 })
const message = (id: string, role: ClaudeMessage['role'] = 'assistant'): ClaudeMessage => ({ id, sessionId: 's', role, content: id, timestamp: 1 })
const filters = { ...DEFAULT_FILTER, tool: false, thinking: false }

test('alternating tools and thinking form one group with separate totals', () => {
  const entries = filterChatEntries([tool('a'), thinking('b'), tool('c'), tool('d'), thinking('e')], filters)
  expect(entries).toEqual([{ kind: 'placeholder', id: 'ph-a', counts: { tool: 3, thinking: 2 } }])
})

test.each(['user', 'assistant', 'system'] as const)('a visible %s message separates hidden groups', role => {
  const visible = message('visible', role)
  expect(filterChatEntries([tool('a'), thinking('b'), visible, thinking('c'), tool('d')], filters)).toEqual([
    { kind: 'placeholder', id: 'ph-a', counts: { tool: 1, thinking: 1 } },
    { kind: 'item', data: visible },
    { kind: 'placeholder', id: 'ph-c', counts: { tool: 1, thinking: 1 } },
  ])
})

test('re-enabling a kind splits the group at the newly visible rows', () => {
  const visible = thinking('b')
  expect(filterChatEntries([tool('a'), visible, tool('c')], { ...filters, thinking: true })).toEqual([
    { kind: 'placeholder', id: 'ph-a', counts: { tool: 1 } },
    { kind: 'item', data: visible },
    { kind: 'placeholder', id: 'ph-c', counts: { tool: 1 } },
  ])
})

test('appending another hidden kind preserves the group key and previous results', () => {
  const history = [tool('a'), thinking('b')]
  const before = filterChatEntries(history, filters)
  const after = filterChatEntries([...history, tool('c')], filters)
  expect(after[0]).toMatchObject({ id: 'ph-a', counts: { tool: 2, thinking: 1 } })
  expect(before[0]).toMatchObject({ id: 'ph-a', counts: { tool: 1, thinking: 1 } })
  expect(history).toHaveLength(2)
})

test('supports all hidden kinds and restores original order when filters are reset', () => {
  const history = [message('u', 'user'), tool('t'), thinking('th'), message('reply')]
  expect(filterChatEntries(history, { you: false, message: false, tool: false, thinking: false })).toEqual([
    { kind: 'placeholder', id: 'ph-u', counts: { you: 1, tool: 1, thinking: 1, message: 1 } },
  ])
  expect(filterChatEntries(history, DEFAULT_FILTER)).toEqual(history.map(data => ({ kind: 'item', data })))
  expect(filterChatEntries([], filters)).toEqual([])
})
