import React from 'react'
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useChatFilterStore, isAnyFilterOff } from '@/stores/chat-filter-store'
import { CHAT_KINDS } from '@/utils/classify-chat-item'
import { appColors, fontSize, spacing } from '@/theme/colors'

export function ChatFilterSettings() {
  const { t } = useTranslation()
  const defaults = useChatFilterStore(s => s.defaultFilter)
  const setDefaultKind = useChatFilterStore(s => s.setDefaultKind)
  const resetDefault = useChatFilterStore(s => s.resetDefault)
  return (
    <>
      <Text style={styles.title}>{t('chatFilter.globalTitle')}</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>{t('chatFilter.globalHint')}</Text>
        {CHAT_KINDS.map(kind => (
          <View key={kind} style={styles.row}>
            <Text style={styles.label}>{t(`chatItem.kind.${kind}`)}</Text>
            <Switch
              testID={`chat-filter-default-${kind}`}
              value={defaults[kind]}
              onValueChange={on => setDefaultKind(kind, on)}
              accessibilityLabel={t('chatFilter.filterA11y', { label: t(`chatItem.kind.${kind}`) })}
              trackColor={{ false: appColors.border, true: appColors.accent }}
              thumbColor="#fff"
            />
          </View>
        ))}
        {isAnyFilterOff(defaults) && (
          <TouchableOpacity style={styles.reset} onPress={resetDefault}>
            <Text style={styles.resetText}>{t('chatFilter.showAll')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xs, color: appColors.textSecondary, textTransform: 'uppercase',
    letterSpacing: 1, marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: spacing.lg,
  },
  card: { backgroundColor: appColors.surface, borderRadius: 12, marginHorizontal: spacing.lg, overflow: 'hidden' },
  hint: { color: appColors.textSecondary, fontSize: fontSize.xs, lineHeight: 18, padding: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: appColors.border,
  },
  label: { color: appColors.text, fontSize: fontSize.md },
  reset: { padding: spacing.lg, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: appColors.border },
  resetText: { color: appColors.accent, fontSize: fontSize.md, fontWeight: '600' },
})
