import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { AppState, Text } from 'react-native'
import { useActivityClock } from '../src/hooks/use-activity-clock'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(
    () => mockFocused ? callback() : undefined, [callback, mockFocused],
  ),
}))
let renderer: Renderer.ReactTestRenderer
let change: (state: string) => void
const remove = jest.fn()
function Clock() { return <Text>{useActivityClock()}</Text> }
beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(1000)
  mockFocused = true
  remove.mockClear()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    change = callback as typeof change
    return { remove }
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  jest.restoreAllMocks()
  jest.useRealTimers()
})
test('covered lists stop their clock and catch up when focused again', () => {
  act(() => { renderer = Renderer.create(<Clock />) })
  expect(jest.getTimerCount()).toBe(1)
  mockFocused = false
  act(() => renderer.update(<Clock />))
  expect(jest.getTimerCount()).toBe(0)
  expect(remove).toHaveBeenCalledTimes(1)
  act(() => jest.advanceTimersByTime(60_000))
  mockFocused = true
  act(() => renderer.update(<Clock />))
  expect(renderer.root.findByType(Text).props.children).toBe(61000)
  expect(jest.getTimerCount()).toBe(1)
})
test('background lists stop ticking and active lists resume without duplicate timers', () => {
  act(() => { renderer = Renderer.create(<Clock />) })
  act(() => change('background'))
  expect(jest.getTimerCount()).toBe(0)
  act(() => jest.advanceTimersByTime(60_000))
  act(() => { change('active'); change('active') })
  expect(jest.getTimerCount()).toBe(1)
  expect(renderer.root.findByType(Text).props.children).toBe(61000)
})
