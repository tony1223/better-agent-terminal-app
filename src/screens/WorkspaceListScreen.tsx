import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import {
  useWorkspaceStore,
  type WorkspaceLoadStatus,
} from '@/stores/workspace-store'
import {
  useConnectionStore,
  workspaceShortcutServerKey,
} from '@/stores/connection-store'
import { useWorkspaceShortcutsStore } from '@/stores/workspace-shortcuts-store'
import { useWorkspaceNavigationStore } from '@/stores/workspace-navigation-store'
import { type WorkspaceEntry } from '@/stores/workspace-browser-store'
import { WorkspaceBrowser } from '@/components/workspace/WorkspaceBrowser'
import { refreshSessionActivity, watchSessionActivity } from '@/stores/session-activity-sync'
import { appColors, spacing, fontSize } from '@/theme/colors'

export function WorkspaceListScreen() {
  const { t } = useTranslation()
  const {
    workspaces,
    loadStatus,
    loadError,
    load,
    switchWorkspace,
    activeLocalProfileId,
  } = useWorkspaceStore()
  const navigation = useNavigation<any>()
  const disconnect = useConnectionStore(s => s.disconnect)
  const channels = useConnectionStore(s => s.channels)
  const profileViewKey = useConnectionStore(s => s.profileViewKey ?? null)
  const mountedViewKey = useRef(profileViewKey).current
  const pendingWorkspace = useWorkspaceNavigationStore(s => s.pending)
  const open = useWorkspaceNavigationStore(s => s.open)
  const [profilePickerOpen, setProfilePickerOpen] = useState(false)

  useEffect(() => {
    if (
      !pendingWorkspace ||
      useWorkspaceNavigationStore.getState().pending?.id !== pendingWorkspace.id
    )
      return
    const connection = useConnectionStore.getState()
    const { finish } = useWorkspaceNavigationStore.getState()
    if (
      connection.client !== pendingWorkspace.client ||
      workspaceShortcutServerKey(connection) !== pendingWorkspace.serverKey
    ) {
      finish(pendingWorkspace.id)
      return
    }
    if (!pendingWorkspace.ready || pendingWorkspace.viewKey !== mountedViewKey)
      return
    if (activeLocalProfileId !== pendingWorkspace.profileId) {
      finish(pendingWorkspace.id)
      return
    }
    if (loadStatus === 'idle' || loadStatus === 'no-channel') return
    if (loadStatus !== 'ok' && loadStatus !== 'empty') {
      finish(
        pendingWorkspace.id,
        loadError || t('workspaceList.quickSwitchFailed'),
      )
      return
    }
    // Explicit profile opening stays at the overview; it never picks a session.
    if (pendingWorkspace.workspaceId === null) {
      finish(pendingWorkspace.id)
      return
    }
    if (
      !workspaces.some(
        workspace => workspace.id === pendingWorkspace.workspaceId,
      )
    ) {
      useWorkspaceShortcutsStore
        .getState()
        .forget(
          pendingWorkspace.serverKey,
          pendingWorkspace.profileId,
          pendingWorkspace.workspaceId,
        )
      finish(pendingWorkspace.id, t('workspaceList.workspaceUnavailable'))
      return
    }
    finish(pendingWorkspace.id)
    switchWorkspace(pendingWorkspace.workspaceId)
    navigation.navigate('WorkspaceDetail', {
      workspaceId: pendingWorkspace.workspaceId,
    })
  }, [
    pendingWorkspace,
    mountedViewKey,
    activeLocalProfileId,
    loadStatus,
    loadError,
    workspaces,
    switchWorkspace,
    navigation,
    t,
  ])

  useFocusEffect(
    useCallback(() => {
      const stopActivity = channels ? watchSessionActivity(channels.claude, null) : undefined
      if (!useWorkspaceNavigationStore.getState().pending) {
        load()
          .then(() => refreshSessionActivity(false))
          .catch(() => {})
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        disconnect()
        return true
      })
      return () => { sub.remove(); stopActivity?.() }
    }, [disconnect, load, channels]),
  )

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity style={styles.backButton} onPress={disconnect}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity
          style={styles.profileChip}
          onPress={() => setProfilePickerOpen(true)}
        >
          <Text style={styles.profileChipText}>
            {t('workspaceBrowser.profiles')}
          </Text>
        </TouchableOpacity>
      ),
    })
  }, [navigation, disconnect, t])

  const openWorkspace = (entry: WorkspaceEntry) => {
    if (pendingWorkspace) return
    if (entry.profileId !== activeLocalProfileId) return open(entry)
    switchWorkspace(entry.workspaceId)
    navigation.navigate('WorkspaceDetail', { workspaceId: entry.workspaceId })
  }
  return (
    <WorkspaceBrowser
      onOpen={openWorkspace}
      onOpenProfile={profileId => open({ profileId, workspaceId: null })}
      profilePickerOpen={profilePickerOpen}
      onProfilePickerChange={setProfilePickerOpen}
      emptyState={
        <EmptyState
          status={loadStatus}
          error={loadError}
          navigation={navigation}
        />
      }
    />
  )
}

function EmptyState({
  status,
  error,
  navigation,
}: {
  status: WorkspaceLoadStatus
  error: string | null
  navigation: any
}) {
  const { t } = useTranslation()
  const disconnect = useConnectionStore(s => s.disconnect)

  if (status === 'idle' || status === 'no-channel') {
    return <Text style={styles.empty}>{t('workspaceList.empty.loading')}</Text>
  }

  if (status === 'no-window') {
    return (
      <View style={styles.diagnostic}>
        <Text style={styles.diagTitle}>
          {t('workspaceList.diagnostic.noWindowTitle')}
        </Text>
        <Text style={styles.diagBody}>
          {t('workspaceList.diagnostic.noWindowBodyBefore')}
          {'\n\n'}
          {t('workspaceList.diagnostic.noWindowBodyRescan')}{' '}
          <Text style={styles.mono}>
            BAT Desktop → Settings → Remote → Show QR Code
          </Text>
          {t('workspaceList.diagnostic.noWindowBodyAfter')}
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={async () => {
            disconnect()
            navigation.getParent?.()?.navigate?.('ScanQR') ??
              navigation.navigate('ScanQR')
          }}
        >
          <Text style={styles.primaryBtnText}>
            {t('workspaceList.button.disconnectRescan')}
          </Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (status === 'parse-error' || status === 'rpc-error') {
    return (
      <View style={styles.diagnostic}>
        <Text style={styles.diagTitle}>
          {t('workspaceList.diagnostic.loadFailedTitle')}
        </Text>
        <Text style={styles.diagBody}>
          {error ?? t('workspaceList.diagnostic.unknownError')}
        </Text>
      </View>
    )
  }

  // status === 'empty' or 'ok' (with no items)
  return (
    <View style={styles.diagnostic}>
      <Text style={styles.diagTitle}>
        {t('workspaceList.diagnostic.noWorkspacesTitle')}
      </Text>
      <Text style={styles.diagBody}>
        {t('workspaceList.diagnostic.noWorkspacesBody')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: appColors.text,
    fontSize: 28,
    lineHeight: 32,
  },
  profileChip: {
    maxWidth: 180,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appColors.surfaceHover,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
  },
  profileChipText: {
    flexShrink: 1,
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  empty: {
    fontSize: fontSize.md,
    color: appColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  diagnostic: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  diagTitle: {
    fontSize: fontSize.lg,
    color: appColors.text,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  diagBody: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    lineHeight: 20,
  },
  mono: {
    fontFamily: 'monospace',
    color: appColors.text,
  },
  primaryBtn: {
    backgroundColor: appColors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
})
