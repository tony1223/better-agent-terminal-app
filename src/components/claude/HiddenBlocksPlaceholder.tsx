import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { CHAT_KINDS, type ChatItemKind } from '@/utils/classify-chat-item'
import type { HiddenKindCounts } from '@/utils/filter-chat-entries'

const KIND_COLOR: Record<ChatItemKind, string> = {
  you: appColors.info,
  message: appColors.textSecondary,
  tool: '#10b981',
  thinking: appColors.warning,
}

interface Props {
  counts: HiddenKindCounts
  onPress: () => void
}

export const HiddenBlocksPlaceholder = React.memo(function HiddenBlocksPlaceholder({
  counts,
  onPress,
}: Props) {
  const { t } = useTranslation()
  const kinds = CHAT_KINDS.filter(kind => (counts[kind] ?? 0) > 0)
  const summary = kinds.map(kind => `${counts[kind]} ${t(`chatItem.kindPlural.${kind}`)}`).join(' · ')
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.container}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={t('chatItem.hiddenA11y', { summary })}
    >
      <View style={styles.dots}>
        {kinds.map(kind => <View key={kind} style={[styles.dot, { backgroundColor: KIND_COLOR[kind] }]} />)}
      </View>
      <Text style={styles.label}>
        {t('chatItem.hiddenLabel', { summary })}
      </Text>
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: appColors.border,
    borderRadius: 999,
    marginVertical: spacing.xs,
  },
  dots: { flexDirection: 'row', gap: 4, flexShrink: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: appColors.textMuted,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
})
