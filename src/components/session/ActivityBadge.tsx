import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, fontSize, spacing } from '@/theme/colors'
import type { SessionActivity } from '@/utils/session-status'

export const ACTIVITY_COLOR: Record<SessionActivity, string> = {
  working: appColors.warning,
  completed: appColors.success,
  idle: appColors.textSecondary,
  stopped: appColors.textMuted,
}

export function ActivityBadge({ activity, count }: { activity: SessionActivity; count?: number }) {
  const { t } = useTranslation()
  const color = ACTIVITY_COLOR[activity]
  const label = t(`session.activity.${activity === 'idle' ? 'ready' : activity}`)
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}18` }]} accessibilityLabel={`${label}${count != null ? ` ${count}` : ''}`}>
      {activity === 'working'
        ? <ActivityIndicator size="small" color={color} />
        : <Text style={[styles.symbol, { color }]}>{activity === 'completed' ? '✓' : '•'}</Text>}
      <Text style={[styles.text, { color }]}>{label}{count != null ? ` ${count}` : ''}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: spacing.xs },
  symbol: { fontSize: fontSize.lg, fontWeight: '800' },
  text: { fontSize: fontSize.sm, fontWeight: '800' },
})
