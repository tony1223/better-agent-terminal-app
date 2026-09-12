import React from 'react'
import { FlatList, View } from 'react-native'
import type { FlatListProps } from 'react-native'

// In an inverted list, offset zero is the latest message. Do not use the
// jump-to-latest button's 80px threshold here: even a small deliberate scroll
// into history must not let incoming tokens pull the reader back to the end.
const VISIBLE_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: 0 }

type Props<T> = Pick<FlatListProps<T>,
  'data' | 'renderItem' | 'keyExtractor' | 'contentContainerStyle' | 'onScroll'
> & {
  listRef?: React.Ref<FlatList<T>>
  streamingContent?: React.ReactNode
}

/** Keep the visible historical row anchored while newer content changes. */
export function ChatHistoryList<T>({ listRef, streamingContent, ...props }: Props<T>) {
  return (
    <FlatList
      {...props}
      ref={listRef}
      inverted
      maintainVisibleContentPosition={VISIBLE_POSITION}
      // Inverted Android lists can detach the native anchor when clipping is
      // enabled. Keep native cells attached; JS window virtualization remains.
      removeClippedSubviews={false}
      scrollEventThrottle={16}
      // Always retain the header slot, including when streaming is committed
      // into data. FlatList adds one to minIndexForVisible for this header, so
      // the anchor is a message, never the growing/shrinking streaming bubble.
      ListHeaderComponent={<View>{streamingContent}</View>}
    />
  )
}
