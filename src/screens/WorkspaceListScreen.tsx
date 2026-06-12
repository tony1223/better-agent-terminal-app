/**
 * WorkspaceListScreen - List and switch workspaces
 */

import React, { useCallback, useLayoutEffect, useMemo } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  ActivityIndicator,
  TextInput,
  BackHandler,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import { useWorkspaceStore, type WorkspaceLoadStatus } from '@/stores/workspace-store'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { getAgentPreset } from '@/types'
import type { ProfileEntry, Workspace } from '@/types'

export function WorkspaceListScreen() {
  const { t } = useTranslation()
  const {
    workspaces,
    activeWorkspaceId,
    loadStatus,
    loadError,
    load,
    loadProfileWorkspace,
    switchWorkspace,
    profiles,
    activeProfileIds,
    activeLocalProfileId,
  } = useWorkspaceStore()
  const navigation = useNavigation<any>()
  const [refreshing, setRefreshing] = React.useState(false)
  const [profileModalVisible, setProfileModalVisible] = React.useState(false)
  const [switchingProfileId, setSwitchingProfileId] = React.useState<string | null>(null)
  const [profileError, setProfileError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const channels = useConnectionStore(s => s.channels)
  const disconnect = useConnectionStore(s => s.disconnect)

  // Pull workspaces fresh from the host whenever this screen regains focus so
  // sessions added/closed on another device (or the desktop) show up without a
  // manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      load()

      // Workspaces is the first tab / app root: back exits to the home (Connect)
      // screen by disconnecting, which flips RootNavigator back to ConnectScreen.
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        disconnect()
        return true
      })
      return () => sub.remove()
    }, [disconnect, load]),
  )

  const activeProfiles = useMemo(
    () => activeProfileIds
      .map(id => profiles.find(profile => profile.id === id))
      .filter((profile): profile is ProfileEntry => !!profile),
    [activeProfileIds, profiles],
  )

  const profileLabel = useMemo(() => {
    // Label with the profile this device is viewing; the host's active set
    // may contain other windows' profiles.
    const viewing = activeLocalProfileId
      ? profiles.find(profile => profile.id === activeLocalProfileId)
      : activeProfiles[0]
    if (!viewing) return t('workspaceList.profile.defaultLabel')
    return viewing.name || viewing.id
  }, [activeLocalProfileId, profiles, activeProfiles, t])

  const filteredWorkspaces = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return workspaces
    return workspaces.filter(workspace => {
      const haystack = [
        workspace.alias,
        workspace.name,
        workspace.folderPath,
        workspace.group,
        workspace.defaultAgent,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [query, workspaces])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => disconnect()}
        >
          <Text style={styles.backButtonText}>{'←'}</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity
          style={styles.profileChip}
          onPress={() => {
            setProfileError(null)
            setProfileModalVisible(true)
          }}
        >
          <Text style={styles.profileChipText} numberOfLines={1}>{profileLabel}</Text>
          <Text style={styles.profileChipCaret}>v</Text>
        </TouchableOpacity>
      ),
    })
  }, [navigation, profileLabel, disconnect])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const selectProfile = async (profile: ProfileEntry) => {
    if (!channels) return
    setSwitchingProfileId(profile.id)
    setProfileError(null)
    try {
      const idsToDeactivate = activeProfileIds.filter(id => id !== profile.id)
      await channels.profile.activate(profile.id)
      await Promise.all(idsToDeactivate.map(id => channels.profile.deactivate(id)))
      await loadProfileWorkspace(profile.id)
      setProfileModalVisible(false)
    } catch (e) {
      setProfileError(String(e))
    } finally {
      setSwitchingProfileId(null)
    }
  }

  const renderWorkspace = ({ item }: { item: Workspace }) => {
    const isActive = item.id === activeWorkspaceId
    const preset = item.defaultAgent ? getAgentPreset(item.defaultAgent) : null

    return (
      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={() => {
          switchWorkspace(item.id)
          navigation.navigate('WorkspaceDetail', { workspaceId: item.id })
        }}
      >
        <View style={styles.cardHeader}>
          {preset && (
            <Text style={[styles.agentBadge, { color: preset.color }]}>
              {preset.icon}
            </Text>
          )}
          <Text style={styles.name} numberOfLines={1}>
            {item.alias || item.name}
          </Text>
          {isActive && (
            <View style={styles.activeDot} />
          )}
        </View>
        <Text style={styles.path} numberOfLines={1}>
          {item.folderPath}
        </Text>
        {item.group && (
          <Text style={styles.group}>{item.group}</Text>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredWorkspaces}
        keyExtractor={(item) => item.id}
        renderItem={renderWorkspace}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          workspaces.length > 0 ? (
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={t('workspaceList.search.placeholder')}
              placeholderTextColor={appColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={appColors.accent}
          />
        }
        ListEmptyComponent={
          query.trim()
            ? <Text style={styles.empty}>{t('workspaceList.empty.noMatch', { query: query.trim() })}</Text>
            : <EmptyState status={loadStatus} error={loadError} navigation={navigation} />
        }
      />
      <ProfileModal
        visible={profileModalVisible}
        profiles={profiles}
        activeProfileIds={activeProfileIds}
        switchingProfileId={switchingProfileId}
        error={profileError}
        onSelect={selectProfile}
        onClose={() => setProfileModalVisible(false)}
        onRefresh={async () => {
          setProfileError(null)
          await load()
        }}
      />
    </View>
  )
}

function ProfileModal({
  visible,
  profiles,
  activeProfileIds,
  switchingProfileId,
  error,
  onSelect,
  onClose,
  onRefresh,
}: {
  visible: boolean
  profiles: ProfileEntry[]
  activeProfileIds: string[]
  switchingProfileId: string | null
  error: string | null
  onSelect: (profile: ProfileEntry) => Promise<void>
  onClose: () => void
  onRefresh: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = React.useState(false)

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <View style={styles.modalTitleBlock}>
            <Text style={styles.modalTitle}>{t('workspaceList.modal.title')}</Text>
            <Text style={styles.modalSubtitle}>{t('workspaceList.modal.subtitle')}</Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>{t('workspaceList.button.close')}</Text>
          </TouchableOpacity>
        </View>
        {error ? <Text style={styles.profileError}>{error}</Text> : null}
        {profiles.length === 0 ? (
          <View style={styles.diagnostic}>
            <Text style={styles.diagTitle}>{t('workspaceList.diagnostic.noProfilesTitle')}</Text>
            <Text style={styles.diagBody}>
              {t('workspaceList.diagnostic.noProfilesBody')}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              disabled={refreshing}
              onPress={async () => {
                setRefreshing(true)
                await onRefresh()
                setRefreshing(false)
              }}
            >
              <Text style={styles.primaryBtnText}>{refreshing ? t('workspaceList.button.refreshing') : t('workspaceList.button.refreshProfiles')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={profiles}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.profileList}
            renderItem={({ item }) => {
              const active = activeProfileIds.includes(item.id)
              const switching = switchingProfileId === item.id
              return (
                <TouchableOpacity
                  style={[styles.profileRow, active && styles.profileRowActive]}
                  onPress={() => onSelect(item)}
                  disabled={!!switchingProfileId}
                >
                  <View style={styles.profileTextBlock}>
                    <Text style={styles.profileName} numberOfLines={1}>{item.name || item.id}</Text>
                    <Text style={styles.profileMeta} numberOfLines={1}>
                      {item.type || 'local'} / {item.id}
                    </Text>
                  </View>
                  {switching ? (
                    <ActivityIndicator color={appColors.accent} />
                  ) : (
                    <Text style={[styles.profileState, active && styles.profileStateActive]}>
                      {active ? t('workspaceList.profile.active') : t('workspaceList.profile.use')}
                    </Text>
                  )}
                </TouchableOpacity>
              )
            }}
          />
        )}
      </View>
    </Modal>
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
        <Text style={styles.diagTitle}>{t('workspaceList.diagnostic.noWindowTitle')}</Text>
        <Text style={styles.diagBody}>
          {t('workspaceList.diagnostic.noWindowBodyBefore')}
          {'\n\n'}
          {t('workspaceList.diagnostic.noWindowBodyRescan')}{' '}
          <Text style={styles.mono}>BAT Desktop → Settings → Remote → Show QR Code</Text>{t('workspaceList.diagnostic.noWindowBodyAfter')}
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={async () => {
            disconnect()
            navigation.getParent?.()?.navigate?.('ScanQR')
              ?? navigation.navigate('ScanQR')
          }}
        >
          <Text style={styles.primaryBtnText}>{t('workspaceList.button.disconnectRescan')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (status === 'parse-error' || status === 'rpc-error') {
    return (
      <View style={styles.diagnostic}>
        <Text style={styles.diagTitle}>{t('workspaceList.diagnostic.loadFailedTitle')}</Text>
        <Text style={styles.diagBody}>{error ?? t('workspaceList.diagnostic.unknownError')}</Text>
      </View>
    )
  }

  // status === 'empty' or 'ok' (with no items)
  return (
    <View style={styles.diagnostic}>
      <Text style={styles.diagTitle}>{t('workspaceList.diagnostic.noWorkspacesTitle')}</Text>
      <Text style={styles.diagBody}>
        {t('workspaceList.diagnostic.noWorkspacesBody')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  list: {
    padding: spacing.lg,
    flexGrow: 1,
  },
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
  profileChipCaret: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  searchInput: {
    color: appColors.text,
    backgroundColor: appColors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    marginBottom: spacing.md,
  },
  cardActive: {
    borderColor: appColors.accent,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agentBadge: {
    fontSize: fontSize.lg,
    marginRight: spacing.sm,
  },
  name: {
    flex: 1,
    fontSize: fontSize.lg,
    color: appColors.text,
    fontWeight: '600',
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: appColors.success,
  },
  path: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
    marginTop: spacing.xs,
  },
  group: {
    fontSize: fontSize.xs,
    color: appColors.accent,
    marginTop: spacing.xs,
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
  modalRoot: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  modalTitleBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  modalTitle: {
    color: appColors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  closeButton: {
    backgroundColor: appColors.surfaceHover,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeButtonText: {
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  profileList: {
    padding: spacing.lg,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  profileRowActive: {
    borderColor: appColors.accent,
  },
  profileTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  profileMeta: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  profileState: {
    color: appColors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginLeft: spacing.md,
  },
  profileStateActive: {
    color: appColors.accent,
  },
  profileError: {
    color: appColors.error,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
})
