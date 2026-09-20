/**
 * MessageBubble - Renders a single Claude message
 */

import React, { useMemo, useState } from 'react'
import { Clipboard, View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useTranslation } from 'react-i18next'
import { createPathLinkerRules } from './LinkedText'
import { hostMarkdown } from '@/utils/host-markdown'
import { ChatTimestamp } from './ChatTimestamp'
import { MessageSelectionButton } from './MessageSelection'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { useClaudeStore } from '@/stores/claude-store'
import type { ClaudeMessage } from '@/types'

interface Props {
  message: ClaudeMessage
  cwd?: string
}

function tint(hex: string, opacity: number): string {
  const value = hex.replace('#', '')
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export const MessageBubble = React.memo(function MessageBubble({ message, cwd }: Props) {
  const { t } = useTranslation()
  const [showThinking, setShowThinking] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const rules = useMemo(() => createPathLinkerRules(cwd), [cwd])

  // The agent's own context summary, replayed as a user turn. Full width and
  // folded shut: it carries the user role but the user never wrote it, and
  // shown raw it buries the actual conversation under a wall of text.
  if (message.isCompactSummary) {
    return (
      <View style={styles.compactContainer}>
        <View style={styles.timestampRow}>
          <MessageSelectionButton text={message.content} />
          <ChatTimestamp timestamp={message.timestamp} />
        </View>
        <TouchableOpacity
          onPress={() => setShowSummary(!showSummary)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.compactHeader}>
            {showSummary ? '▼ ' : '▶ '}
            {t('messageBubble.compactSummary')}
          </Text>
        </TouchableOpacity>
        {showSummary && (
          <Text style={styles.compactBody} selectable>{message.content}</Text>
        )}
      </View>
    )
  }

  if (message.role === 'system') {
    return (
      <View style={styles.systemContainer}>
        <View style={styles.timestampRow}>
          <MessageSelectionButton text={message.content} />
          <ChatTimestamp timestamp={message.timestamp} />
        </View>
        <Text style={styles.systemText} selectable>{message.content}</Text>
      </View>
    )
  }

  const isUser = message.role === 'user'
  const pending = isUser && message.status === 'sending'
  const sent = isUser && message.status === 'sent'
  const failed = isUser && message.status === 'failed'
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
        pending && styles.pendingBubble,
        failed && styles.failedBubble,
      ]}
    >
      <View style={styles.timestampRow}>
        <MessageSelectionButton text={message.content.trim() ? message.content : message.thinking || ''} />
        <ChatTimestamp timestamp={message.timestamp} />
      </View>
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
        <Markdown markdownit={hostMarkdown} style={markdownStyles} rules={rules}>
          {message.content}
        </Markdown>
      ) : null}

      {pending && (
        <Text style={styles.deliveryText}>{t('messageBubble.sending')}</Text>
      )}
      {sent && (
        <Text style={styles.deliveryText}>{'✓ '}{t('messageBubble.sentToHost')}</Text>
      )}
      {failed && (
        <>
          {message.reconnectRetry === 'pending' && (
            <Text style={styles.deliveryText}>{t('messageBubble.retryOnReconnect')}</Text>
          )}
          {message.reconnectRetry === 'used' && (
            <Text style={styles.failedText}>{t('messageBubble.retryExhausted')}</Text>
          )}
          {message.sendPayload ? (
            <TouchableOpacity
              onPress={() => useClaudeStore.getState().retryUserMessage(message.sessionId, message.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.failedText}>
                {t('messageBubble.failedToSend')}{'  ·  '}
                <Text style={styles.retryText}>{t('messageBubble.tapToRetry')}</Text>
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.failedText} selectable>{t('messageBubble.failedToSend')}</Text>
          )}
          {/* Selectable: the reason is the one thing worth copying out of here. */}
          {!!message.failureReason && (
            <Text style={styles.failureReasonText} selectable>{message.failureReason}</Text>
          )}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('messageBubble.copyMessage')}
            style={styles.copyButton} onPress={() => Clipboard.setString(message.sendPayload?.messageText ?? message.content)}>
            <Text style={styles.deliveryText}>{t('messageBubble.copyMessage')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  copyButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' },
  timestampRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
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
  pendingBubble: {
    opacity: 0.55,
  },
  failedBubble: {
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  failedText: {
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    color: '#ef4444',
  },
  failureReasonText: {
    marginTop: 2,
    fontSize: fontSize.xs,
    // Dimmer than the failure line above it: the verdict leads, the detail
    // supports.
    color: '#ef444499',
  },
  retryText: {
    fontSize: fontSize.xs,
    color: '#ef4444',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  deliveryText: {
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    alignSelf: 'flex-end',
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
  compactContainer: {
    alignSelf: 'stretch',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    backgroundColor: appColors.messageBubble,
  },
  compactHeader: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontWeight: '600',
  },
  compactBody: {
    marginTop: spacing.sm,
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
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
