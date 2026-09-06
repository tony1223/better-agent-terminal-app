/**
 * ConnectionBanner - "reconnecting" strip shown over whatever screen the user
 * is on.
 *
 * The app now stays mounted through a drop (RootNavigator keeps the stack
 * while the client retries), so something has to say why nothing is loading —
 * and give a way to stop waiting out the backoff.
 */

import React, { useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing, fontSize } from '@/theme/colors'

export function ConnectionBanner() {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const status = useConnectionStore(s => s.status)
  const sessionActive = useConnectionStore(s => s.sessionActive)
  const retryNow = useConnectionStore(s => s.retryNow)
  const disconnect = useConnectionStore(s => s.disconnect)
  const profileStatus = useConnectionStore(s => s.profileStatus)
  const attempts = useRef(0)
  useEffect(() => {
    if (profileStatus === 'ready') attempts.current = 0
    if (status !== 'connected' || profileStatus !== 'unavailable' || attempts.current >= 3) return
    const delay = 1000 * 2 ** attempts.current++
    const timer = setTimeout(retryNow, delay)
    return () => clearTimeout(timer)
  }, [status, profileStatus, retryNow])

  // Only while a session is being restored: a fresh connect has its own
  // screen, and a session that truly ended already sends the user back there.
  if (!sessionActive || (status === 'connected' && profileStatus !== 'unavailable')) return null

  return (
    <View style={[styles.wrap, { top: insets.top + spacing.xs }]} pointerEvents="box-none">
      <View style={styles.banner}>
        <ActivityIndicator size="small" color={appColors.warning} />
        <Text style={styles.text} numberOfLines={1}>{t('connection.reconnecting')}</Text>
        <TouchableOpacity onPress={retryNow} hitSlop={styles.hitSlop}>
          <Text style={styles.action}>{t('connection.retry')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={disconnect} hitSlop={styles.hitSlop}>
          <Text style={styles.actionMuted}>{t('connection.leave')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: appColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  text: {
    color: appColors.text,
    fontSize: fontSize.sm,
  },
  action: {
    color: appColors.accent,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  actionMuted: {
    color: appColors.textSecondary,
    fontSize: fontSize.sm,
  },
  hitSlop: { top: 8, bottom: 8, left: 8, right: 8 },
})
