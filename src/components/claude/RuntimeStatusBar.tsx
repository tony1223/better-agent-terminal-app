/**
 * RuntimeStatusBar - host-side turn lifecycle indicator.
 *
 * Fills the gap between "message delivered to the host" and the first model
 * frame: the host broadcasts runtimeStatus ('starting' → 'waiting_for_api',
 * plus 'compacting'/'queued') over agent:status and clears it once the model
 * starts responding — after that the streaming/thinking output takes over.
 */

import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { appColors, spacing, fontSize } from '@/theme/colors'

interface Props {
  status: string
  since: number | null
}

const STATUS_KEYS: Record<string, string> = {
  starting: 'claude.runtimeStatus.preparing',
  queued: 'claude.runtimeStatus.queued',
  waiting_for_api: 'claude.runtimeStatus.waiting',
  compacting: 'claude.runtimeStatus.compacting',
}

export function RuntimeStatusBar({ status, since }: Props) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const key = STATUS_KEYS[status]
  const label = key ? t(key) : status
  const elapsed = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0

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
