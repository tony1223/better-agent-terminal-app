/**
 * Quotes, code blocks, rules and tables must not keep the markdown library's
 * white-page defaults. They merge into our sheets key by key, so a missing
 * override left blockquotes on #F5F5F5 under our near-white text: on Android
 * a quoted line rendered as an empty white box.
 */

import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { StyleSheet, View } from 'react-native'
import { MessageBubble } from '../src/components/claude/MessageBubble'
import { StreamingText } from '../src/components/claude/StreamingText'
import { MessageSelectionProvider } from '../src/components/claude/MessageSelection'
import type { ClaudeMessage } from '../src/types'

jest.unmock('react-native-markdown-display')
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native')
  return { SafeAreaProvider: RNView, SafeAreaView: RNView }
})

const content = '> single quote\n\n> outer\n>> nested\n\n    indented code\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
const LIGHT = /^#(f5f5f5|ccc|cccccc|000000|000|fff|ffffff)$/i

function lightColours(tree: Renderer.ReactTestRenderer): string[] {
  const found: string[] = []
  for (const node of tree.root.findAllByType(View)) {
    const style = StyleSheet.flatten(node.props.style) ?? {}
    for (const key of ['backgroundColor', 'borderColor', 'borderLeftColor'] as const) {
      const value = style[key]
      if (typeof value === 'string' && LIGHT.test(value)) found.push(`${key}=${value}`)
    }
  }
  return found
}

let renderer: Renderer.ReactTestRenderer
afterEach(() => { act(() => renderer?.unmount()) })

test('a finished message paints no light fills or borders', () => {
  const message: ClaudeMessage = { id: 'm', sessionId: 's', role: 'assistant', content, timestamp: 1 }
  act(() => { renderer = Renderer.create(<MessageSelectionProvider><MessageBubble message={message} /></MessageSelectionProvider>) })
  expect(renderer.root.findAllByType(View).length).toBeGreaterThan(0)
  expect(lightColours(renderer)).toEqual([])
})

test('a streaming message paints no light fills or borders', () => {
  act(() => { renderer = Renderer.create(<MessageSelectionProvider><StreamingText text={content} /></MessageSelectionProvider>) })
  expect(lightColours(renderer)).toEqual([])
})
