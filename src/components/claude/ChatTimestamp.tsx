import React from 'react'
import { Alert, StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatChatTimestamp } from '@/utils/chat-timestamp'
import { fontSize } from '@/theme/colors'

export function ChatTimestamp({ timestamp }: { timestamp: number }) {
  const { t } = useTranslation()
  const formatted = formatChatTimestamp(timestamp)
  if (!formatted) return null
  return <Text
    style={styles.time}
    accessibilityRole="button"
    accessibilityLabel={formatted.full}
    accessibilityHint={t('chatTimestamp.hint')}
    onPress={event => {
      event.stopPropagation()
      Alert.alert(t('chatTimestamp.title'), formatted.full)
    }}
  >{formatted.short}</Text>
}

const styles = StyleSheet.create({
  time: { color: '#d0d0d0', fontSize: fontSize.sm, fontVariant: ['tabular-nums'], flexShrink: 0, paddingVertical: 4 },
})
