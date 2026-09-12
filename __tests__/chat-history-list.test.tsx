import React from 'react'
import Renderer, { act } from 'react-test-renderer'
import { FlatList, ScrollView, Text } from 'react-native'
import { ChatHistoryList } from '../src/components/claude/ChatHistoryList'

type Item = { id: string; text: string }
const history: Item[] = [
  { id: 'newer', text: 'Recent message' },
  { id: 'older', text: 'Historical message being read' },
]
const keyExtractor = (item: Item) => item.id
const renderItem = ({ item }: { item: Item }) => <Text testID={item.id}>{item.text}</Text>
let renderer: Renderer.ReactTestRenderer

function render(data = history, streamingContent?: React.ReactNode) {
  const element = <ChatHistoryList data={data} renderItem={renderItem} keyExtractor={keyExtractor} streamingContent={streamingContent} />
  act(() => {
    if (renderer) renderer.update(element)
    else renderer = Renderer.create(element)
  })
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined as unknown as Renderer.ReactTestRenderer
  jest.restoreAllMocks()
})

test('anchors message rows natively, excludes the streaming header and disables clipping', () => {
  render(history, <Text>Streaming response</Text>)
  const list = renderer.root.findByType(FlatList)
  expect(list.props.inverted).toBe(true)
  expect(list.props.removeClippedSubviews).toBe(false)
  expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0, autoscrollToTopThreshold: 0 })
  // Exercise the real FlatList/VirtualizedList translation to the native view.
  const nativeScroll = renderer.root.findByType(ScrollView)
  expect(nativeScroll.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 1, autoscrollToTopThreshold: 0 })
})

test('keeps the native list, header slot and historical row mounted across stream growth and commit', () => {
  render(history, <Text>First token</Text>)
  const nativeScroll = renderer.root.findByType(ScrollView).instance
  const historicalRow = renderer.root.findByProps({ testID: 'older' }).instance
  const config = renderer.root.findByType(FlatList).props.maintainVisibleContentPosition

  render(history, <Text>{'Growing response\n'.repeat(50)}</Text>)
  expect(renderer.root.findByType(ScrollView).instance).toBe(nativeScroll)
  expect(renderer.root.findByProps({ testID: 'older' }).instance).toBe(historicalRow)

  render([{ id: 'committed', text: 'Completed response' }, ...history])
  expect(renderer.root.findByType(ScrollView).instance).toBe(nativeScroll)
  expect(renderer.root.findByProps({ testID: 'older' }).instance).toBe(historicalRow)
  expect(renderer.root.findByType(FlatList).props.maintainVisibleContentPosition).toBe(config)
  expect(renderer.root.findByType(ScrollView).props.maintainVisibleContentPosition.minIndexForVisible).toBe(1)
  expect(renderer.root.findByType(FlatList).props.ListHeaderComponent).not.toBeNull()
})

test('content changes do not run a competing JS scroll-to-bottom or offset compensation', () => {
  render()
  const list = renderer.root.findByType(FlatList).instance
  const scrollToOffset = jest.spyOn(list, 'scrollToOffset')
  const scrollToEnd = jest.spyOn(list, 'scrollToEnd')
  render(history, <Text>New stream</Text>)
  render([{ id: 'tool', text: 'New tool output' }, ...history], <Text>More tokens</Text>)
  render([{ id: 'tool', text: 'Expanded tool output\n'.repeat(30) }, ...history])
  expect(scrollToOffset).not.toHaveBeenCalled()
  expect(scrollToEnd).not.toHaveBeenCalled()
})

test('exposes the list ref for an explicit jump and forwards scroll events for the button', () => {
  const listRef = React.createRef<FlatList<Item>>()
  const onScroll = jest.fn()
  act(() => {
    renderer = Renderer.create(<ChatHistoryList data={history} renderItem={renderItem} keyExtractor={keyExtractor} listRef={listRef} onScroll={onScroll} />)
  })
  expect(listRef.current).toBe(renderer.root.findByType(FlatList).instance)
  const event = { nativeEvent: { contentOffset: { y: 25 } } }
  act(() => renderer.root.findByType(FlatList).props.onScroll(event))
  expect(onScroll).toHaveBeenCalledWith(event)
  // A reader just 25px into history is already outside the native auto-follow
  // threshold, regardless of whether the floating jump button is shown yet.
  expect(renderer.root.findByType(ScrollView).props.maintainVisibleContentPosition.autoscrollToTopThreshold).toBe(0)
})
