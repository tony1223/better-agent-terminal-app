/**
 * RuntimeStatusBar - persistent turn "working" indicator, mirroring the host.
 *
 * Spans the whole turn (turnStartedAt → turn-end) with an elapsed counter, and
 * a verb that tracks the live phase:
 *   - host runtimeStatus override (compacting/queued immediately; preparing /
 *     waiting only after a short grace period, matching the desktop's 8s delay)
 *   - else Responding… when assistant text is streaming
 *   - else Thinking… when only thinking is streaming
 *   - else Working… (request sent / tool running, nothing streamed yet)
 */

import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, spacing, fontSize } from '@/theme/colors'

interface Props {
  runtimeStatus: string | null
  runtimeSince: number | null
  turnStartedAt: number | null
  responding: boolean
  thinking: boolean
}

// compacting/queued are surfaced immediately; preparing/waiting only after this
// grace period so a fast turn doesn't flash an alarming "still waiting" message.
const WAITING_GRACE_MS = 8000

const IMMEDIATE_STATUS_KEYS: Record<string, string> = {
  compacting: 'claude.runtimeStatus.compacting',
  queued: 'claude.runtimeStatus.queued',
}
const DELAYED_STATUS_KEYS: Record<string, string> = {
  starting: 'claude.runtimeStatus.preparing',
  waiting_for_api: 'claude.runtimeStatus.waiting',
}

export function RuntimeStatusBar({ runtimeStatus, runtimeSince, turnStartedAt, responding, thinking }: Props) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  const active = turnStartedAt != null || !!runtimeStatus

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  const statusElapsedMs = runtimeSince ? now - runtimeSince : 0
  let label: string | null = null
  if (runtimeStatus && IMMEDIATE_STATUS_KEYS[runtimeStatus]) {
    label = t(IMMEDIATE_STATUS_KEYS[runtimeStatus])
  } else if (runtimeStatus && DELAYED_STATUS_KEYS[runtimeStatus] && statusElapsedMs >= WAITING_GRACE_MS) {
    label = t(DELAYED_STATUS_KEYS[runtimeStatus])
  }
  if (!label) {
    label = responding
      ? t('claude.runtimeStatus.responding')
      : thinking
        ? t('claude.runtimeStatus.thinking')
        : t('claude.runtimeStatus.working')
  }

  const elapsed = turnStartedAt ? Math.max(0, Math.floor((now - turnStartedAt) / 1000)) : 0

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={appColors.warning} />
      <Text style={styles.text}>
        {label}
        {elapsed > 0 ? ` · ${elapsed}s` : ''}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
  },
})
