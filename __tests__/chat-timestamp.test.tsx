import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Alert, Text, TouchableOpacity } from 'react-native'
import { formatChatTimestamp } from '../src/utils/chat-timestamp'
import { ChatTimestamp } from '../src/components/claude/ChatTimestamp'
import { ToolCallCard } from '../src/components/claude/ToolCallCard'
import { MessageBubble } from '../src/components/claude/MessageBubble'
import { useClaudeStore } from '../src/stores/claude-store'
import type { ClaudeMessage, ClaudeToolCall } from '../src/types'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const now = new Date(2026, 8, 12, 22, 27, 38)
const timestamp = new Date(2026, 8, 12, 22, 25, 6).getTime()
let renderer: Renderer.ReactTestRenderer | undefined
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now) })
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('today shows seconds; older dates include the year, date and time', () => {
  expect(formatChatTimestamp(timestamp, now)).toEqual({ short: '22:25:06', full: '2026-09-12 22:25:06' })
  expect(formatChatTimestamp(new Date(2025, 8, 11, 1, 2, 3).getTime(), now)).toEqual({ short: '2025-09-11 01:02:03', full: '2025-09-11 01:02:03' })
  expect(formatChatTimestamp(new Date(2026, 8, 11, 23, 59, 59).getTime(), now)?.short).toBe('2026-09-11 23:59:59')
})

test.each([0, -1, NaN, Infinity, 9e20])('does not invent a time for invalid timestamp %s', value => {
  expect(formatChatTimestamp(value, now)).toBeNull()
  act(() => { renderer = Renderer.create(<ChatTimestamp timestamp={value} />) })
  expect(renderer!.toJSON()).toBeNull()
})

test('tapping the time shows full date without toggling its parent tool card', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  const stopPropagation = jest.fn()
  act(() => { renderer = Renderer.create(<ChatTimestamp timestamp={timestamp} />) })
  const text = renderer!.root.findByType(Text)
  expect(text.props.children).toBe('22:25:06')
  expect(text.props.accessibilityLabel).toBe('2026-09-12 22:25:06')
  act(() => { text.props.onPress({ stopPropagation }) })
  expect(stopPropagation).toHaveBeenCalled()
  expect(alert).toHaveBeenCalledWith('chatTimestamp.title', '2026-09-12 22:25:06')
})

test.each(['running', 'completed', 'error'] as const)('a %s tool shows its time even while collapsed with a long command', status => {
  const tool: ClaudeToolCall = { id: 't', sessionId: 's', toolName: 'Bash', timestamp, status, input: { command: 'a'.repeat(300) } }
  act(() => { renderer = Renderer.create(<ToolCallCard tool={tool} />) })
  const header = renderer!.root.findByType(TouchableOpacity)
  expect(header.findByType(ChatTimestamp).props.timestamp).toBe(timestamp)
  // The long summary is outside the header, so it cannot push the time away.
  expect(header.findAllByType(Text).some(text => text.props.children === 'a'.repeat(120))).toBe(false)
  expect(renderer!.root.findAllByType(Text).some(text => text.props.children === 'a'.repeat(120))).toBe(true)
  expect(renderer!.root.findAllByType(Text).some(text => text.props.children === '22:25:06')).toBe(true)
})

test.each([
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'reply' },
  { role: 'assistant', content: '', thinking: 'thinking' },
  { role: 'system', content: 'system' },
  { role: 'user', content: 'summary', isCompactSummary: true },
] as const)('shows timestamps on $role messages including collapsed thinking and summaries', props => {
  const message: ClaudeMessage = { id: 'm', sessionId: 's', timestamp, ...props }
  act(() => { renderer = Renderer.create(<MessageBubble message={message} />) })
  expect(renderer!.root.findByType(ChatTimestamp).props.timestamp).toBe(timestamp)
})

test('history without host timestamps does not appear to have happened just now', () => {
  useClaudeStore.setState({ sessions: {}, activeSessionId: null })
  const message = { id: 'm', sessionId: 's', role: 'assistant', content: 'old reply' } as ClaudeMessage
  const tool = { id: 't', sessionId: 's', toolName: 'Bash', input: {}, status: 'completed' } as ClaudeToolCall
  useClaudeStore.getState().handleHistory('s', [message, tool])
  expect(useClaudeStore.getState().sessions.s.messages.map(item => item.timestamp)).toEqual([0, 0])
})
