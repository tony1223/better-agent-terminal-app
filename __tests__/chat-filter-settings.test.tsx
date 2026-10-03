import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { ChatFilterSettings } from '../src/components/claude/ChatFilterSettings'
import { ChatFilterStrip } from '../src/components/claude/ChatFilterStrip'
import { DEFAULT_FILTER, useChatFilterStore } from '../src/stores/chat-filter-store'

const mockStoredValues = new Map<string, string>()
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => mockStoredValues.get(key),
    set: (key: string, value: string) => mockStoredValues.set(key, value),
  }),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const storageKey = 'chat-filter-state-v1'
const counts = { you: 1, message: 2, tool: 3, thinking: 4 }
let renderer: Renderer.ReactTestRenderer | undefined
const store = () => useChatFilterStore.getState()
function reloadStore() {
  let reloaded!: typeof useChatFilterStore
  jest.isolateModules(() => { reloaded = require('../src/stores/chat-filter-store').useChatFilterStore })
  return reloaded.getState()
}

beforeEach(() => {
  mockStoredValues.clear()
  useChatFilterStore.setState({ defaultFilter: { ...DEFAULT_FILTER }, filters: {}, open: {} })
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
})

test('existing and new sessions inherit global visibility until explicitly overridden', () => {
  expect(store().getFilter('existing')).toEqual(DEFAULT_FILTER)
  store().setDefaultKind('tool', false)
  store().setDefaultKind('thinking', false)
  expect(store().getFilter('existing')).toEqual({ ...DEFAULT_FILTER, tool: false, thinking: false })
  expect(store().getFilter('new')).toBe(store().defaultFilter)
  store().setKind('existing', 'tool', true)
  expect(store().getFilter('existing')).toEqual({ ...DEFAULT_FILTER, thinking: false })
  store().setDefaultKind('thinking', true)
  expect(store().getFilter('existing').thinking).toBe(false)
  expect(store().getFilter('new').thinking).toBe(true)
  store().reset('existing')
  expect(store().getFilter('existing')).toBe(store().defaultFilter)
})

test('promoting a session to global defaults resumes inheritance and preserves other overrides', () => {
  store().setKind('other', 'message', false)
  store().setKind('source', 'tool', false)
  store().setKind('source', 'thinking', false)
  store().setAsDefault('source')
  expect(store().filters.source).toBeUndefined()
  expect(store().getFilter('source')).toBe(store().defaultFilter)
  expect(store().getFilter('new')).toEqual({ ...DEFAULT_FILTER, tool: false, thinking: false })
  expect(store().getFilter('other')).toEqual({ ...DEFAULT_FILTER, message: false })
  store().resetDefault()
  expect(store().getFilter('new')).toEqual(DEFAULT_FILTER)
  expect(store().getFilter('other').message).toBe(false)
})

test('global defaults and overrides survive reopening, panel state changes, and session cleanup', () => {
  store().setDefaultKind('tool', false)
  store().setDefaultKind('thinking', false)
  store().setKind('custom', 'tool', true)
  store().setOpen('custom', true)
  store().toggleOpen('temporary')
  store().clearSession('temporary')
  const reloaded = reloadStore()
  expect(reloaded.defaultFilter).toEqual({ ...DEFAULT_FILTER, tool: false, thinking: false })
  expect(reloaded.getFilter('custom')).toEqual({ ...DEFAULT_FILTER, thinking: false })
  expect(reloaded.isOpen('custom')).toBe(true)
  expect(reloaded.isOpen('temporary')).toBe(false)
})

test('existing saved session filters migrate to overrides without guessing a global preference', () => {
  mockStoredValues.set(storageKey, JSON.stringify({
    filters: { old: { ...DEFAULT_FILTER, tool: false, thinking: false } }, open: { old: true },
  }))
  const reloaded = reloadStore()
  expect(reloaded.defaultFilter).toEqual(DEFAULT_FILTER)
  expect(reloaded.getFilter('old').tool).toBe(false)
  expect(reloaded.getFilter('new')).toEqual(DEFAULT_FILTER)
  reloaded.setDefaultKind('message', false)
  expect(reloadStore().getFilter('old').message).toBe(true)
})

test('invalid persisted default fields use safe built-in values', () => {
  mockStoredValues.set(storageKey, JSON.stringify({ defaultFilter: { tool: false, thinking: 'false' } }))
  expect(reloadStore().defaultFilter).toEqual({ ...DEFAULT_FILTER, tool: false })
  mockStoredValues.set(storageKey, '{broken JSON')
  expect(reloadStore().defaultFilter).toEqual(DEFAULT_FILTER)
})

test('settings update an open session live; an all-visible local override can return to global', () => {
  store().setOpen('chat', true)
  act(() => {
    renderer = Renderer.create(<>
      <ChatFilterSettings />
      <ChatFilterStrip sessionId="chat" counts={counts} />
    </>)
  })
  const chip = (kind: string) => renderer!.root.findByProps({ testID: `chat-filter-${kind}` })
  act(() => renderer!.root.findByProps({ testID: 'chat-filter-default-tool' }).props.onValueChange(false))
  expect(chip('tool').props.accessibilityState.checked).toBe(false)
  expect(store().filters.chat).toBeUndefined()
  act(() => chip('tool').props.onPress())
  expect(store().getFilter('chat')).toEqual(DEFAULT_FILTER)
  expect(store().getFilter('another').tool).toBe(false)
  expect(renderer!.root.findAllByType(Text).some(node => node.props.children === 'chatFilter.sessionOverride')).toBe(true)
  act(() => renderer!.root.findByProps({ testID: 'chat-filter-follow-global' }).props.onPress())
  expect(chip('tool').props.accessibilityState.checked).toBe(false)
  expect(renderer!.root.findAllByType(Text).some(node => node.props.children === 'chatFilter.followingGlobal')).toBe(true)
})

test('the session strip can save its current visibility as the global default', () => {
  store().setOpen('chat', true)
  act(() => { renderer = Renderer.create(<ChatFilterStrip sessionId="chat" counts={counts} />) })
  act(() => renderer!.root.findByProps({ testID: 'chat-filter-tool' }).props.onPress())
  act(() => renderer!.root.findByProps({ testID: 'chat-filter-thinking' }).props.onPress())
  act(() => renderer!.root.findByProps({ testID: 'chat-filter-set-default' }).props.onPress())
  expect(store().getFilter('new')).toEqual({ ...DEFAULT_FILTER, tool: false, thinking: false })
  expect(store().filters.chat).toBeUndefined()
  expect(renderer!.root.findAllByProps({ testID: 'chat-filter-follow-global' })).toHaveLength(0)
  expect(reloadStore().defaultFilter).toEqual(store().defaultFilter)
})
