import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, fontSize, spacing } from '@/theme/colors'
import type { SessionSort } from '@/utils/session-recency'

export function SessionSortControl({ value, onChange }: { value: SessionSort; onChange: (value: SessionSort) => void }) {
  const { t } = useTranslation()
  return <View style={styles.row}>{(['recent', 'activity', 'original'] as const).map(sort => <TouchableOpacity key={sort} accessibilityRole="button" accessibilityState={{ selected: value === sort }} style={[styles.button, value === sort && styles.selected]} onPress={() => onChange(sort)}><Text style={styles.text}>{t(`session.recency.sort.${sort}`)}</Text></TouchableOpacity>)}</View>
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm },
  button: { borderWidth: 1, borderColor: appColors.border, borderRadius: 8, padding: spacing.sm },
  selected: { borderColor: appColors.accent, backgroundColor: appColors.accentDim },
  text: { color: appColors.text, fontSize: fontSize.sm },
})
