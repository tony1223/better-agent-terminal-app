import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useChatFilterStore, isAnyFilterOff } from '@/stores/chat-filter-store'
import { appColors, spacing } from '@/theme/colors'

interface Props {
  sessionId: string
}

export const ChatFilterButton = React.memo(function ChatFilterButton({ sessionId }: Props) {
  const isOpen = useChatFilterStore(s => s.isOpen(sessionId))
  const filters = useChatFilterStore(s => s.getFilter(sessionId))
  const toggleOpen = useChatFilterStore(s => s.toggleOpen)
  const anyOff = isAnyFilterOff(filters)

  return (
    <TouchableOpacity
      style={[styles.button, isOpen && styles.buttonActive]}
      onPress={() => toggleOpen(sessionId)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Filter chat messages"
      accessibilityState={{ expanded: isOpen }}
    >
      <Text style={[styles.glyph, isOpen && styles.glyphActive]}>{'\u2261'}</Text>
      {anyOff && <View style={styles.badge} />}
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    backgroundColor: 'transparent',
  },
  buttonActive: {
    backgroundColor: 'rgba(217, 119, 6, 0.16)',
  },
  glyph: {
    fontSize: 20,
    lineHeight: 22,
    color: appColors.textSecondary,
    fontWeight: '700',
  },
  glyphActive: {
    color: appColors.accent,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: appColors.accent,
    borderWidth: 1.5,
    borderColor: appColors.background,
  },
})
