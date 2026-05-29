import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { type ChatItemKind } from '@/utils/classify-chat-item'

const KIND_COLOR: Record<ChatItemKind, string> = {
  you: appColors.info,
  message: appColors.textSecondary,
  tool: '#10b981',
  thinking: appColors.warning,
}

interface Props {
  kind: ChatItemKind
  count: number
  onPress: () => void
}

export const HiddenBlocksPlaceholder = React.memo(function HiddenBlocksPlaceholder({
  kind,
  count,
  onPress,
}: Props) {
  const { t } = useTranslation()
  const label = t(`chatItem.kindPlural.${kind}`)
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.container}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={t('chatItem.hiddenA11y', { count, label })}
    >
      <View style={[styles.dot, { backgroundColor: KIND_COLOR[kind] }]} />
      <Text style={styles.label}>
        {t('chatItem.hiddenLabel', { count, label })}
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
