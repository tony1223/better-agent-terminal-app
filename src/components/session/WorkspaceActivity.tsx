import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useClaudeStore } from '@/stores/claude-store'
import { useActivityClock } from '@/hooks/use-activity-clock'
import { deriveAgentActivity } from '@/utils/session-status'
import { isSdkAgentSession, type TerminalInstance } from '@/types'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { ActivityBadge } from './ActivityBadge'

export function WorkspaceActivity({ terminals, compact = false }: { terminals: TerminalInstance[]; compact?: boolean }) {
  const now = useActivityClock()
  // Return a primitive so token-by-token stream events do not rerender the list.
  const counts = useClaudeStore(state => {
    let working = 0
    let completed = 0
    for (const terminal of terminals) {
      if (!isSdkAgentSession(terminal)) continue
      const activity = deriveAgentActivity(state.sessions[terminal.id], now)
      if (activity === 'working') working++
      if (activity === 'completed') completed++
    }
    return `${working}:${completed}`
  })
  const [working, completed] = counts.split(':').map(Number)
  return <WorkspaceActivityCounts total={terminals.length} working={working} completed={completed} compact={compact} />
}

export function WorkspaceActivityCounts({ total, working, completed = 0, compact = false }: { total: number; working: number; completed?: number; compact?: boolean }) {
  const { t } = useTranslation()
  if (compact) {
    return <Text numberOfLines={1} style={styles.compact}>
      {t('workspaceList.sessions', { count: total })}
      {working > 0 && <Text style={styles.working}> · {t('session.activity.working')}{` ${working}`}</Text>}
      {completed > 0 && <Text style={styles.completed}> · {t('session.activity.completed')}{` ${completed}`}</Text>}
    </Text>
  }
  return (
    <View style={styles.row}>
      {working > 0 && <ActivityBadge activity="working" count={working} />}
      {completed > 0 && <ActivityBadge activity="completed" count={completed} />}
      {working === 0 && completed === 0 && <Text style={styles.count}>{t('workspaceList.sessions', { count: total })}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  compact: { color: appColors.textSecondary, fontSize: fontSize.xs, flexShrink: 1 },
  working: { color: appColors.warning, fontWeight: '700' },
  completed: { color: appColors.success, fontWeight: '700' },
  count: { color: appColors.textSecondary, fontSize: fontSize.sm },
})
