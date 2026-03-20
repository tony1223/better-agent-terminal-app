/**
 * MessageBubble - Renders a single Claude message
 */

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { pathLinkerRules } from './LinkedText'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { ClaudeMessage } from '@/types'

interface Props {
  message: ClaudeMessage
}

export const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  const [showThinking, setShowThinking] = useState(false)

  if (message.role === 'system') {
    return (
      <View style={styles.systemContainer}>
        <Text style={styles.systemText}>{message.content}</Text>
      </View>
    )
  }

  const isUser = message.role === 'user'

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      {/* Thinking toggle */}
      {message.thinking && (
        <TouchableOpacity
          style={styles.thinkingToggle}
          onPress={() => setShowThinking(!showThinking)}
        >
          <Text style={styles.thinkingToggleText}>
            {showThinking ? '\u25BC Thinking' : '\u25B6 Thinking'}
          </Text>
        </TouchableOpacity>
      )}
      {showThinking && message.thinking && (
        <View style={styles.thinkingBlock}>
          <Text style={styles.thinkingText}>{message.thinking}</Text>
        </View>
      )}

      {/* Content */}
      {isUser ? (
        <Text style={styles.userText}>{message.content}</Text>
      ) : (
        <Markdown style={markdownStyles} rules={pathLinkerRules}>
          {message.content}
        </Markdown>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
    maxWidth: '95%',
  },
  userContainer: {
    alignSelf: 'flex-end',
    backgroundColor: appColors.accentDim,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    padding: spacing.md,
  },
  assistantContainer: {
    alignSelf: 'flex-start',
    backgroundColor: appColors.surface,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: spacing.md,
    width: '95%',
  },
  systemContainer: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  userText: {
    fontSize: fontSize.md,
    color: appColors.text,
  },
  systemText: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    fontStyle: 'italic',
  },
  thinkingToggle: {
    marginBottom: spacing.sm,
  },
  thinkingToggleText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
  },
  thinkingBlock: {
    backgroundColor: appColors.background,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  thinkingText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
  },
})

const markdownStyles = StyleSheet.create({
  body: {
    color: appColors.text,
    fontSize: fontSize.md,
  },
  code_inline: {
    backgroundColor: appColors.background,
    color: appColors.accent,
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: appColors.background,
    borderRadius: 8,
    padding: spacing.md,
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: appColors.text,
  },
  link: {
    color: appColors.info,
  },
  heading1: {
    color: appColors.text,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    marginVertical: spacing.sm,
  },
  heading2: {
    color: appColors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginVertical: spacing.sm,
  },
  heading3: {
    color: appColors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginVertical: spacing.xs,
  },
})
