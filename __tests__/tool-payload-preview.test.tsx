import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import { useClaudeStore } from '../src/stores/claude-store'
import { ToolCallCard } from '../src/components/claude/ToolCallCard'
import type { ClaudeToolCall } from '../src/types'

jest.mock('../src/components/claude/LinkedText', () => ({ LinkedText: 'LinkedText' }))
jest.mock('../src/components/claude/RemoteImagePreview', () => ({ RemoteImagePreview: 'RemoteImagePreview' }))

const tool: ClaudeToolCall = {
  id: 'tool', sessionId: 'session', toolName: 'Edit', status: 'running', timestamp: 1,
  input: { changes: [{ path: 'image.b64', diff: 'head…tail' }] },
  payloadPreview: { input: true, result: false },
}

beforeEach(() => useClaudeStore.setState({ sessions: {}, activeSessionId: null }))

test('snapshot and replay retain tool preview metadata and all timeline rows', () => {
  const store = useClaudeStore.getState()
  store.handleSessionState('session', {
    messages: [tool, { id: 'reply', sessionId: 'session', role: 'assistant', content: 'Ready', timestamp: 2 }],
    isStreaming: true,
  })
  store.handleToolResult('session', {
    id: 'tool', status: 'completed', result: 'result preview', payloadPreview: { result: true },
  })
  const session = useClaudeStore.getState().sessions.session
  expect(session.messages).toHaveLength(2)
  expect(session.isStreaming).toBe(true)
  expect(session.messages[0]).toMatchObject({
    input: tool.input, result: 'result preview', payloadPreview: { input: true, result: true },
  })
  store.handleToolResult('session', { id: 'tool', status: 'completed', result: 'Full small result' })
  expect(useClaudeStore.getState().sessions.session.messages[0]).toMatchObject({
    payloadPreview: { input: true, result: false },
  })
})

test('expanded tools disclose a preview and ordinary tools do not', () => {
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => { renderer = TestRenderer.create(<ToolCallCard tool={tool} />) })
  expect(JSON.stringify(renderer.toJSON())).not.toContain('toolCall.largePayloadPreview')
  act(() => { renderer.root.findByType(TouchableOpacity).props.onPress() })
  expect(JSON.stringify(renderer.toJSON())).toContain('toolCall.largePayloadPreview')
  act(() => { renderer.update(<ToolCallCard tool={{ ...tool, payloadPreview: undefined }} />) })
  expect(JSON.stringify(renderer.toJSON())).not.toContain('toolCall.largePayloadPreview')
  act(() => { renderer.unmount() })
})
