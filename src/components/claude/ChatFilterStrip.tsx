import React from 'react'
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useChatFilterStore, isAnyFilterOff } from '@/stores/chat-filter-store'
import { CHAT_KINDS, type ChatItemKind } from '@/utils/classify-chat-item'
import { appColors, spacing, fontSize } from '@/theme/colors'

const KIND_COLOR: Record<ChatItemKind, string> = {
  you: appColors.info,
  message: appColors.textSecondary,
  tool: '#10b981',
  thinking: appColors.warning,
}

interface Props {
  sessionId: string
  counts: Record<ChatItemKind, number>
}

export const ChatFilterStrip = React.memo(function ChatFilterStrip({ sessionId, counts }: Props) {
  const { t } = useTranslation()
  const isOpen = useChatFilterStore(s => s.isOpen(sessionId))
  const filters = useChatFilterStore(s => s.getFilter(sessionId))
  const toggleKind = useChatFilterStore(s => s.toggleKind)
  const reset = useChatFilterStore(s => s.reset)
  const anyOff = isAnyFilterOff(filters)

  // No LayoutAnimation on open/close: under the New Architecture (Fabric) it can
  // crash in RCTPerformMountInstructions while mounting/unmounting this strip.
  if (!isOpen) return null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{t('chatFilter.showInThread')}</Text>
        {anyOff && (
          <TouchableOpacity onPress={() => reset(sessionId)} activeOpacity={0.75}>
            <Text style={styles.resetLink}>{t('chatFilter.reset')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.chips}>
        {CHAT_KINDS.map(kind => {
          const on = filters[kind]
          const dotColor = KIND_COLOR[kind]
          return (
            <TouchableOpacity
              key={kind}
              onPress={() => toggleKind(sessionId, kind)}
              style={[
                styles.chip,
                on ? { borderColor: dotColor, backgroundColor: tint(dotColor) } : styles.chipOff,
              ]}
              activeOpacity={0.75}
              accessibilityRole="switch"
              accessibilityLabel={t('chatFilter.filterA11y', { label: t(`chatItem.kind.${kind}`) })}
              accessibilityState={{ checked: on }}
            >
              <View
                style={[
                  styles.dot,
                  on
                    ? { backgroundColor: dotColor, borderColor: dotColor }
                    : { borderColor: appColors.textMuted },
                ]}
              />
              <Text style={[styles.chipLabel, !on && styles.chipLabelOff]}>{t(`chatItem.kind.${kind}`)}</Text>
              <Text style={styles.chipCount}>{counts[kind] ?? 0}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
})

function tint(hex: string): string {
  const value = hex.replace('#', '')
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, 0.14)`
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: appColors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: appColors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerLabel: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    letterSpacing: 1.2,
  },
  resetLink: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
    color: appColors.accent,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  chipOff: {
    borderColor: appColors.border,
    backgroundColor: appColors.background,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  chipLabel: {
    color: appColors.text,
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  chipLabelOff: {
    color: appColors.textSecondary,
  },
  chipCount: {
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: appColors.textMuted,
    marginLeft: 2,
  },
})
