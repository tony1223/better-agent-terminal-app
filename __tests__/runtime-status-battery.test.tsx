import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { AppState, Text } from 'react-native'
import { RuntimeStatusBar } from '../src/components/claude/RuntimeStatusBar'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let renderer: Renderer.ReactTestRenderer | undefined
let stateChanged: (state: string) => void
const props = { runtimeStatus: 'working', runtimeSince: null, turnStartedAt: 1000, responding: false, thinking: false }
beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(2000)
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    stateChanged = callback as typeof stateChanged
    return { remove: jest.fn() }
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test('runtime elapsed timer pauses in background and catches up immediately on return', () => {
  act(() => { renderer = Renderer.create(<RuntimeStatusBar {...props} />) })
  expect(jest.getTimerCount()).toBe(1)
  act(() => stateChanged('background'))
  expect(jest.getTimerCount()).toBe(0)
  act(() => jest.advanceTimersByTime(60_000))
  act(() => stateChanged('active'))
  expect(jest.getTimerCount()).toBe(1)
  const text = renderer!.root.findAllByType(Text).map(node => React.Children.toArray(node.props.children).join('')).join('')
  expect(text).toContain('61s')
  act(() => renderer!.update(<RuntimeStatusBar {...props} runtimeStatus={null} turnStartedAt={null} />))
  expect(jest.getTimerCount()).toBe(0)
})
