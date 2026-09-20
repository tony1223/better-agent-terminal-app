import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Clipboard, Modal, Text, TouchableOpacity } from 'react-native'
import { MessageSelectionButton, MessageSelectionProvider } from '../src/components/claude/MessageSelection'
import { MessageBubble } from '../src/components/claude/MessageBubble'
import { StreamingText } from '../src/components/claude/StreamingText'
import type { ClaudeMessage } from '../src/types'

jest.unmock('react-native-markdown-display')
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native')
  return { SafeAreaProvider: View, SafeAreaView: View }
})

const content = '# Heading\n\nFirst paragraph.\nSecond line.\n\n- First point\n- Second point\n\n```ts\nconst x = 1\n```\n\n[File](./README.md)\n'
const message: ClaudeMessage = { id: 'm', sessionId: 's', role: 'assistant', content, timestamp: 1 }
let renderer: Renderer.ReactTestRenderer
const selectedText = () => renderer.root.findByProps({ testID: 'message-selection-text' })
const render = (children: React.ReactNode) => act(() => {
  renderer = Renderer.create(<MessageSelectionProvider>{children}</MessageSelectionProvider>)
})
const update = (children: React.ReactNode) => act(() => {
  renderer.update(<MessageSelectionProvider>{children}</MessageSelectionProvider>)
})
const press = (label: string) => act(() => {
  const button = renderer.root.findAllByType(TouchableOpacity).find(node =>
    node.props.accessibilityLabel === label || node.findAllByType(Text).some(text => text.props.children === label))
  expect(button).toBeDefined()
  button!.props.onPress()
})
afterEach(() => { act(() => renderer?.unmount()); jest.restoreAllMocks() })

test('one continuous selectable text contains all paragraphs, lists, code and links verbatim', () => {
  render(<MessageBubble message={message} />)
  // Normal rendering keeps interactive links; selection mode is explicit.
  expect(renderer.root.findAllByProps({ accessibilityRole: 'link' }).length).toBeGreaterThan(0)
  press('messageSelection.open')
  expect(selectedText().props).toMatchObject({ selectable: true, children: content })
  expect(typeof selectedText().props.children).toBe('string')
  expect(renderer.root.findByType(Modal).findAllByType(Text).filter(node => node.props.selectable)).toHaveLength(1)
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {})
  press('messageSelection.copyAll')
  expect(copy).toHaveBeenCalledWith(content)
  press('common.close')
  expect(renderer.root.findAllByType(Modal)).toHaveLength(0)
})

test('selection snapshot survives updates and virtualized row removal; reopening gets current text', () => {
  render(<MessageBubble message={message} />)
  press('messageSelection.open')
  const originalText = selectedText()
  update(<MessageBubble message={{ ...message, content: content + 'New data' }} />)
  expect(selectedText()).toBe(originalText)
  expect(selectedText().props.children).toBe(content)
  update(null)
  expect(selectedText().props.children).toBe(content)
  act(() => renderer.root.findByType(Modal).props.onRequestClose())
  expect(renderer.root.findAllByType(Modal)).toHaveLength(0)
  update(<MessageBubble message={{ ...message, content: 'Latest' }} />)
  press('messageSelection.open')
  expect(selectedText().props.children).toBe('Latest')
})

test('streaming selection stays frozen through new tokens and stream completion', () => {
  render(<StreamingText text={content} />)
  press('messageSelection.open')
  update(<StreamingText text={content + 'Next token'} />)
  expect(selectedText().props.children).toBe(content)
  update(<MessageBubble message={message} />)
  expect(selectedText().props.children).toBe(content)
})

test.each([
  { ...message, role: 'user' as const },
  { ...message, role: 'system' as const },
  { ...message, isCompactSummary: true },
  { ...message, content: '', thinking: content },
])('selection is available for user/system/summary/thinking messages %#', variant => {
  render(<MessageBubble message={variant} />)
  press('messageSelection.open')
  expect(selectedText().props.children).toBe(content)
})

test('empty text has no selection action', () => {
  render(<MessageSelectionButton text={'  \n'} />)
  expect(renderer.root.findAllByType(TouchableOpacity)).toHaveLength(0)
})

test('a failed message offers direct copy of its original send text', () => {
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {})
  render(<MessageBubble message={{ ...message, role: 'user', status: 'failed', reconnectRetry: 'used',
    failureReason: 'Connection closed', content: 'display text', sendPayload: { messageText: content } }} />)
  press('messageBubble.copyMessage')
  expect(copy).toHaveBeenCalledWith(content)
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'messageBubble.retryExhausted')).toBe(true)
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Connection closed' && node.props.selectable)).toBe(true)
})
