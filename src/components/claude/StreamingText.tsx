/**
 * StreamingText - Displays streaming Claude response with cursor
 */

import React, { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { pathLinkerRules } from './LinkedText'
import { appColors, spacing, fontSize } from '@/theme/colors'

interface Props {
  text: string
  thinking?: string
}

export const StreamingText = React.memo(function StreamingText({ text, thinking }: Props) {
  const cursorOpacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [cursorOpacity])

  return (
    <View style={styles.container}>
      {thinking ? (
        <View style={styles.thinkingBlock}>
          <Text style={styles.thinkingLabel}>Thinking...</Text>
          <Text style={styles.thinkingText}>{thinking}</Text>
        </View>
      ) : null}

      {text ? (
        <View style={styles.textBlock}>
          <Markdown style={markdownStyles} rules={pathLinkerRules}>
            {text}
          </Markdown>
          <Animated.View style={[styles.cursor, { opacity: cursorOpacity }]} />
        </View>
      ) : (
        <View style={styles.loadingRow}>
          <Animated.View style={[styles.cursor, { opacity: cursorOpacity }]} />
        </View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    backgroundColor: appColors.messageBubble,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: spacing.md,
    marginBottom: spacing.md,
    maxWidth: '95%',
  },
  thinkingBlock: {
    backgroundColor: appColors.background,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  thinkingLabel: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
  },
  thinkingText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
  textBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  cursor: {
    width: 8,
    height: 18,
    backgroundColor: appColors.accent,
    borderRadius: 1,
    marginLeft: 2,
  },
})

const markdownStyles = StyleSheet.create({
  body: {
    color: appColors.text,
    fontSize: fontSize.md,
  },
  code_inline: {
    backgroundColor: '#111111',
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  fence: {
    backgroundColor: appColors.background,
    borderRadius: 8,
    padding: spacing.md,
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: appColors.text,
  },
})
