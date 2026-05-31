/**
 * MessageBubble - Renders a single Claude message
 */

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useTranslation } from 'react-i18next'
import { pathLinkerRules } from './LinkedText'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { ClaudeMessage } from '@/types'

interface Props {
  message: ClaudeMessage
}

function tint(hex: string, opacity: number): string {
  const value = hex.replace('#', '')
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  const { t } = useTranslation()
  const [showThinking, setShowThinking] = useState(false)

  if (message.role === 'system') {
    return (
      <View style={styles.systemContainer}>
        <Text style={styles.systemText} selectable>{message.content}</Text>
      </View>
    )
  }

  const isUser = message.role === 'user'
  const isThinkingOnly = message.role === 'assistant' && !!message.thinking && !message.content.trim()
  // Tints the assistant bubble background/border by role; the textual role
  // label header was removed since the bubble layout already conveys it.
  const kindColor = isUser ? appColors.info : isThinkingOnly ? appColors.warning : appColors.textSecondary

  return (
    <View
      style={[
        styles.container,
        isUser
          ? styles.userContainer
          : [
            styles.assistantContainer,
            {
              backgroundColor: tint(kindColor, isThinkingOnly ? 0.12 : 0.08),
              borderLeftColor: kindColor,
            },
          ],
      ]}
    >
      {/* Thinking toggle */}
      {message.thinking && (
        <TouchableOpacity
          style={styles.thinkingToggle}
          onPress={() => setShowThinking(!showThinking)}
        >
          <Text style={styles.thinkingToggleText}>
            {showThinking ? '\u25BC ' + t('messageBubble.thinkingToggle') : '\u25B6 ' + t('messageBubble.thinkingToggle')}
          </Text>
        </TouchableOpacity>
      )}
      {showThinking && message.thinking && (
        <View style={styles.thinkingBlock}>
          <Text style={styles.thinkingText} selectable>{message.thinking}</Text>
        </View>
      )}

      {/* Content */}
      {isUser ? (
        <Text style={styles.userText} selectable>{message.content}</Text>
      ) : message.content.trim() ? (
        <Markdown style={markdownStyles} rules={pathLinkerRules}>
          {message.content}
        </Markdown>
      ) : null}
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
    backgroundColor: appColors.messageBubble,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    borderLeftWidth: 4,
    borderLeftColor: appColors.textSecondary,
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
    backgroundColor: '#111111',
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    fontWeight: '700',
    paddingHorizontal: 5,
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
