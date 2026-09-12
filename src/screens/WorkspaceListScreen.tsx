/**
 * WorkspaceListScreen - List and switch workspaces
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  ActivityIndicator,
  ScrollView,
  TextInput,
  BackHandler,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import { useWorkspaceStore, type WorkspaceLoadStatus } from '@/stores/workspace-store'
import { useConnectionStore, workspaceShortcutServerKey } from '@/stores/connection-store'
import { recentWorkspaceShortcuts, useWorkspaceShortcutsStore, type WorkspaceShortcut } from '@/stores/workspace-shortcuts-store'
import { WorkspaceActivity } from '@/components/session/WorkspaceActivity'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { getAgentPreset } from '@/types'
import type { ProfileEntry, Workspace } from '@/types'

export function WorkspaceListScreen() {
  const { t } = useTranslation()
  const {
    workspaces,
    terminals,
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
  const selectedProfileName = useConnectionStore(s => s.selectedProfileName)
  const serverKey = useConnectionStore(workspaceShortcutServerKey)
  const shortcutServers = useWorkspaceShortcutsStore(s => s.servers)
  const switching = useRef(false)

  // Pull workspaces fresh from the host whenever this screen regains focus so
  // sessions added/closed on another device (or the desktop) show up without a
  // manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      load().catch(() => {})

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
    if (!viewing) return selectedProfileName || t('workspaceList.profile.defaultLabel')
    return viewing.name || viewing.id
  }, [activeLocalProfileId, profiles, activeProfiles, selectedProfileName, t])

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

  const shortcuts = useMemo(() => recentWorkspaceShortcuts(
    serverKey ? shortcutServers[serverKey] ?? [] : [],
    profiles.map(p => p.id), activeLocalProfileId, workspaces,
    loadStatus === 'ok' || loadStatus === 'empty',
  ), [serverKey, shortcutServers, profiles, activeLocalProfileId, workspaces, loadStatus])

  // The open is recorded by WorkspaceDetailScreen rather than here, so every
  // arrival counts once however you got there — chip, card, or deep link.
  const openWorkspace = useCallback((workspace: Workspace) => {
    if (switching.current) return
    switchWorkspace(workspace.id)
    navigation.navigate('WorkspaceDetail', { workspaceId: workspace.id })
  }, [navigation, switchWorkspace])

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
    if (switching.current) return
    setRefreshing(true)
    try { await load() } catch (e) { setProfileError(String(e)) }
    finally { setRefreshing(false) }
  }

  const selectProfile = async (profile: ProfileEntry) => {
    if (!channels || switching.current) return
    switching.current = true
    setSwitchingProfileId(profile.id)
    setProfileError(null)
    try {
      // Selecting a profile changes only what this device is viewing. The
      // host's active set belongs to its desktop windows and must not be
      // collapsed when a mobile client switches views.
      await loadProfileWorkspace(profile.id)
      setQuery('')
      setProfileModalVisible(false)
    } catch (e) {
      setProfileError(String(e))
    } finally {
      setSwitchingProfileId(null)
      switching.current = false
    }
  }

  const openShortcut = async (shortcut: WorkspaceShortcut) => {
    if (!channels || switching.current) return
    switching.current = true
    const client = useConnectionStore.getState().client
    setSwitchingProfileId(shortcut.profileId)
    setProfileError(null)
    try {
      await loadProfileWorkspace(shortcut.profileId)
      const connection = useConnectionStore.getState()
      if (connection.client !== client || workspaceShortcutServerKey(connection) !== serverKey) return
      const current = useWorkspaceStore.getState()
      if (current.activeLocalProfileId !== shortcut.profileId) return
      if (current.loadStatus !== 'ok' && current.loadStatus !== 'empty') {
        throw new Error(current.loadError || t('workspaceList.quickSwitchFailed'))
      }
      if (!current.workspaces.some(w => w.id === shortcut.workspaceId)) {
        if (serverKey) useWorkspaceShortcutsStore.getState().forget(serverKey, shortcut.profileId, shortcut.workspaceId)
        throw new Error(t('workspaceList.workspaceUnavailable'))
      }
      setQuery('')
      current.switchWorkspace(shortcut.workspaceId)
      navigation.navigate('WorkspaceDetail', { workspaceId: shortcut.workspaceId })
    } catch (e) {
      setProfileError(String(e))
    } finally {
      switching.current = false
      setSwitchingProfileId(null)
    }
  }

  const renderWorkspace = ({ item }: { item: Workspace }) => {
    const isActive = item.id === activeWorkspaceId
    const preset = item.defaultAgent ? getAgentPreset(item.defaultAgent) : null

    return (
      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={() => openWorkspace(item)}
        disabled={!!switchingProfileId}
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
            <Text style={styles.currentLabel}>{t('workspaceList.profile.active')}</Text>
          )}
        </View>
        <Text style={styles.path} numberOfLines={1}>
          {item.folderPath}
        </Text>
        {item.group && (
          <Text style={styles.group}>{item.group}</Text>
        )}
        <WorkspaceActivity terminals={terminals.filter(terminal => terminal.workspaceId === item.id)} />
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
            <View>
              <View style={styles.frequentBlock}>
                <Text style={styles.frequentTitle}>{t('workspaceList.recent.title')}</Text>
                <Text style={styles.recentHint}>{t('workspaceList.recent.hint')}</Text>
                {shortcuts.length === 0 && <Text style={styles.recentHint}>{t('workspaceList.recent.empty')}</Text>}
                {shortcuts.map(shortcut => {
                  const isCurrent = shortcut.profileId === activeLocalProfileId && shortcut.workspaceId === activeWorkspaceId
                  const workspace = shortcut.profileId === activeLocalProfileId ? workspaces.find(w => w.id === shortcut.workspaceId) : null
                  return (
                    <TouchableOpacity
                      key={JSON.stringify([shortcut.profileId, shortcut.workspaceId])}
                      testID={`workspace-shortcut-${shortcut.profileId}-${shortcut.workspaceId}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${profiles.find(p => p.id === shortcut.profileId)?.name ?? shortcut.profileName} / ${workspace?.alias || workspace?.name || shortcut.name}`}
                      style={[styles.shortcutCard, isCurrent && styles.cardActive]}
                      onPress={() => openShortcut(shortcut)}
                      disabled={!!switchingProfileId}
                    >
                      <View style={styles.cardHeader}>
                        <Text style={styles.shortcutProfile}>{profiles.find(p => p.id === shortcut.profileId)?.name ?? shortcut.profileName}</Text>
                        {switchingProfileId === shortcut.profileId ? <ActivityIndicator color={appColors.accent} /> : isCurrent ? <Text style={styles.currentLabel}>{t('workspaceList.profile.active')}</Text> : null}
                      </View>
                      <Text style={styles.name} numberOfLines={1}>{workspace?.alias || workspace?.name || shortcut.name}</Text>
                      <Text style={styles.path} numberOfLines={1}>{workspace?.folderPath ?? shortcut.folderPath}</Text>
                      {shortcut.profileId === activeLocalProfileId && <WorkspaceActivity terminals={terminals.filter(terminal => terminal.workspaceId === shortcut.workspaceId)} />}
                    </TouchableOpacity>
                  )
                })}
              </View>
              <Text style={styles.frequentTitle}>{t('workspaceList.browseTitle')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileStrip}>
                {profiles.map(profile => (
                  <TouchableOpacity key={profile.id} accessibilityRole="button" accessibilityState={{ selected: profile.id === activeLocalProfileId }} style={[styles.profileChip, profile.id === activeLocalProfileId && styles.cardActive]} onPress={() => selectProfile(profile)} disabled={!!switchingProfileId}>
                    <Text style={styles.profileChipText}>{profile.name}</Text>
                    {switchingProfileId === profile.id && <ActivityIndicator color={appColors.accent} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {profileError && !profileModalVisible ? <Text accessibilityRole="alert" style={styles.profileError}>{profileError}</Text> : null}
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
            </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing || !!switchingProfileId}
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
        activeLocalProfileId={activeLocalProfileId}
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
  activeLocalProfileId,
  switchingProfileId,
  error,
  onSelect,
  onClose,
  onRefresh,
}: {
  visible: boolean
  profiles: ProfileEntry[]
  activeProfileIds: string[]
  activeLocalProfileId: string | null
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
              const active = activeLocalProfileId
                ? item.id === activeLocalProfileId
                : activeProfileIds.includes(item.id)
              const switching = switchingProfileId === item.id
              return (
                <TouchableOpacity
                  style={[styles.profileRow, active && styles.profileRowActive]}
                  onPress={() => onSelect(item)}
                  disabled={!!switchingProfileId}
                >
                  <View style={styles.profileTextBlock}>
                    <Text style={styles.profileName} numberOfLines={1}>{item.name || item.id}</Text>
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
  frequentBlock: {
    marginBottom: spacing.md,
  },
  frequentTitle: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  profileStrip: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  shortcutCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
    backgroundColor: appColors.surface,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  recentHint: {
    color: appColors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
  },
  shortcutProfile: {
    flex: 1,
    color: appColors.accent,
    fontSize: fontSize.sm,
    fontWeight: '800',
    marginBottom: spacing.xs,
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
  currentLabel: {
    fontSize: fontSize.sm,
    color: appColors.accent,
    fontWeight: '700',
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
