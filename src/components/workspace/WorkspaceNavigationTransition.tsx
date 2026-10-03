import React, { useEffect } from 'react'
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useConnectionStore, workspaceShortcutServerKey } from '@/stores/connection-store'
import { useWorkspaceNavigationStore } from '@/stores/workspace-navigation-store'
import { appColors, fontSize, spacing } from '@/theme/colors'

/** Lives outside the profile-keyed navigator, covering the entire handoff. */
export function WorkspaceNavigationTransition({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const pending = useWorkspaceNavigationStore(s => s.pending)
  const client = useConnectionStore(s => s.client)
  const serverKey = useConnectionStore(workspaceShortcutServerKey)

  useEffect(() => {
    if (pending && (pending.client !== client || pending.serverKey !== serverKey)) {
      useWorkspaceNavigationStore.getState().finish(pending.id)
    }
  }, [pending, client, serverKey])

  useEffect(() => {
    if (!pending) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [pending])

  return (
    <View style={styles.root}>
      <View
        style={styles.root}
        pointerEvents={pending ? 'none' : 'auto'}
        accessibilityElementsHidden={!!pending}
        importantForAccessibility={pending ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {pending && (
        <View
          testID="workspace-navigation-transition"
          style={styles.overlay}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}
        >
          <ActivityIndicator size="large" color={appColors.accent} />
          <Text style={styles.title}>{t('workspaceBrowser.opening')}</Text>
          {!!pending.label && <Text style={styles.label}>{pending.label}</Text>}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: appColors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  title: { color: appColors.text, fontSize: fontSize.lg, marginTop: spacing.lg },
  label: { color: appColors.textSecondary, fontSize: fontSize.md, marginTop: spacing.sm, textAlign: 'center' },
})
