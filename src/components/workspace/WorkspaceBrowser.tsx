import React, { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewToken,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  useConnectionStore,
  workspaceShortcutServerKey,
} from '@/stores/connection-store'
import { useWorkspaceShortcutsStore } from '@/stores/workspace-shortcuts-store'
import {
  browserEntries,
  emptyBrowser,
  filterBrowserEntries,
  useWorkspaceBrowserStore,
  workspaceEntryKey,
  type WorkspaceEntry,
} from '@/stores/workspace-browser-store'
import { useWorkspaceNavigationStore } from '@/stores/workspace-navigation-store'
import { useWorkspaceShortcutActivity } from '@/hooks/use-workspace-shortcut-activity'
import { workspaceActivityKey } from '@/stores/workspace-shortcut-activity'
import { refreshSessionActivity } from '@/stores/session-activity-sync'
import {
  WorkspaceActivity,
  WorkspaceActivityCounts,
} from '@/components/session/WorkspaceActivity'
import { appColors, fontSize, spacing } from '@/theme/colors'

interface Props {
  onOpen: (entry: WorkspaceEntry) => void | Promise<void>
  onOpenProfile: (profileId: string) => void | Promise<void>
  emptyState?: React.ReactElement
  profilePickerOpen?: boolean
  onProfilePickerChange?: (open: boolean) => void
}

export function WorkspaceBrowser({
  onOpen,
  onOpenProfile,
  emptyState,
  profilePickerOpen,
  onProfilePickerChange,
}: Props) {
  const { t } = useTranslation()
  const {
    profiles,
    workspaces,
    terminals,
    activeLocalProfileId,
    activeWorkspaceId,
    loadStatus,
    loadError,
    load,
  } = useWorkspaceStore()
  const serverKey = useConnectionStore(workspaceShortcutServerKey) ?? ''
  const status = useConnectionStore(s => s.status)
  const preferences = useWorkspaceBrowserStore(
    s => s.servers[serverKey] ?? emptyBrowser,
  )
  const shortcuts = useWorkspaceShortcutsStore(s => s.servers[serverKey])
  const pending = useWorkspaceNavigationStore(s => s.pending)
  const error = useWorkspaceNavigationStore(s => s.error)
  const [localPicker, setLocalPicker] = useState(false)
  const [profileQuery, setProfileQuery] = useState('')
  const [reordering, setReordering] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<string[]>([])
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<WorkspaceEntry>[] }) => {
      const next = viewableItems.map(token => workspaceEntryKey(token.item))
      setVisibleKeys(previous =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      )
    },
  ).current
  const picker = profilePickerOpen ?? localPicker
  const setPicker = onProfilePickerChange ?? setLocalPicker
  const configure = (
    changes: Parameters<
      ReturnType<typeof useWorkspaceBrowserStore.getState>['configure']
    >[1],
  ) => useWorkspaceBrowserStore.getState().configure(serverKey, changes)
  const entries = useMemo(
    () =>
      browserEntries(
        preferences,
        shortcuts ?? [],
        profiles,
        activeLocalProfileId,
        workspaces,
        loadStatus === 'ok' || loadStatus === 'empty',
      ),
    [
      preferences,
      shortcuts,
      profiles,
      activeLocalProfileId,
      workspaces,
      loadStatus,
    ],
  )
  const visible = useMemo(
    () => filterBrowserEntries(entries, preferences),
    [entries, preferences],
  )
  // Inspect only displayed work, never connect every unvisited profile just to build the catalog.
  const inViewport = visible.filter(entry =>
    visibleKeys.includes(workspaceEntryKey(entry)),
  )
  const activity = useWorkspaceShortcutActivity(
    (inViewport.length ? inViewport : visible.slice(0, 12)).filter(
      entry => entry.profileId !== activeLocalProfileId,
    ),
  )
  const selectedProfile = profiles.find(
    profile => profile.id === preferences.profileId,
  )
  const profileNeedle = profileQuery.trim().toLocaleLowerCase()
  const filteredProfiles = profiles.filter(profile =>
    [profile.name, profile.id]
      .join(' ')
      .toLocaleLowerCase()
      .includes(profileNeedle),
  )

  const refresh = async () => {
    if (pending || refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      await Promise.all([
        load().then(refreshSessionActivity),
        activity.refresh(),
      ])
    } catch (cause) {
      setRefreshError(String(cause))
    } finally {
      setRefreshing(false)
    }
  }
  const chooseFilter = (profileId: string | null) => {
    configure({ profileId })
    setPicker(false)
    setProfileQuery('')
  }
  const openProfile = (profileId: string) => {
    configure({ profileId, mode: 'all', query: '' })
    setPicker(false)
    setProfileQuery('')
    return onOpenProfile(profileId)
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <View style={styles.row}>
          {(['pinned', 'all'] as const).map(mode => (
            <TouchableOpacity
              key={mode}
              testID={`workspace-mode-${mode}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: preferences.mode === mode }}
              style={[styles.tab, preferences.mode === mode && styles.selected]}
              onPress={() => {
                configure({ mode })
                setReordering(false)
              }}
            >
              <Text
                style={[
                  styles.text,
                  preferences.mode === mode && styles.accent,
                ]}
              >
                {t(`workspaceBrowser.${mode}`)}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            testID="workspace-profile-filter"
            style={styles.filter}
            accessibilityRole="button"
            onPress={() => setPicker(true)}
          >
            <Text style={styles.text} numberOfLines={1}>
              {selectedProfile?.name ||
                preferences.profileId ||
                t('workspaceBrowser.allProfiles')}{' '}
              ▾
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.search}
          value={preferences.query}
          onChangeText={query => configure({ query })}
          accessibilityLabel={t('workspaceBrowser.search')}
          placeholder={t('workspaceBrowser.search')}
          placeholderTextColor={appColors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <View style={styles.row}>
          <Text style={[styles.hint, styles.flex]}>
            {t(
              preferences.mode === 'pinned'
                ? 'workspaceBrowser.pinnedHint'
                : 'workspaceBrowser.catalogHint',
            )}
          </Text>
          {preferences.mode === 'pinned' && preferences.pins.length > 1 && (
            <TouchableOpacity
              testID="workspace-reorder"
              style={styles.action}
              onPress={() => setReordering(!reordering)}
            >
              <Text style={styles.accent}>
                {t(
                  reordering
                    ? 'workspaceBrowser.done'
                    : 'workspaceBrowser.reorder',
                )}
              </Text>
            </TouchableOpacity>
          )}
          {preferences.profileId && (
            <TouchableOpacity
              style={styles.action}
              onPress={() => chooseFilter(null)}
            >
              <Text style={styles.accent}>
                {t('workspaceBrowser.clearFilter')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {(error || refreshError || loadError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error || refreshError || loadError}
          </Text>
        )}
        {pending && (
          <View style={styles.row}>
            <ActivityIndicator color={appColors.accent} />
            <Text style={styles.hint}>{t('workspaceBrowser.opening')}</Text>
          </View>
        )}
      </View>
      <FlatList
        data={visible}
        keyExtractor={workspaceEntryKey}
        keyboardShouldPersistTaps="handled"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={appColors.accent}
          />
        }
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const key = workspaceEntryKey(item)
          const pinned = preferences.pins.includes(key)
          const current =
            item.profileId === activeLocalProfileId &&
            item.workspaceId === activeWorkspaceId
          const summary = activity.summaries[workspaceActivityKey(item)]
          return (
            <View style={[styles.workspace, current && styles.current]}>
              <TouchableOpacity
                style={styles.destination}
                testID={`workspace-shortcut-${item.profileId}-${item.workspaceId}`}
                accessibilityRole="button"
                accessibilityLabel={`${item.profileName} / ${item.name}`}
                accessibilityState={{ selected: current, disabled: !!pending }}
                disabled={!!pending}
                onPress={() => onOpen(item)}
              >
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <View style={styles.row}>
                  <Text style={styles.source} numberOfLines={1}>
                    {item.profileName}
                  </Text>
                  {status !== 'connected' ? (
                    <Text style={styles.hint}>
                      {t('workspaceBrowser.offline')}
                    </Text>
                  ) : item.profileId === activeLocalProfileId &&
                    (loadStatus === 'ok' || loadStatus === 'empty') ? (
                    <WorkspaceActivity
                      compact
                      terminals={terminals.filter(
                        terminal => terminal.workspaceId === item.workspaceId,
                      )}
                    />
                  ) : summary ? (
                    <WorkspaceActivityCounts compact {...summary} />
                  ) : (
                    <Text style={styles.hint}>
                      {t('workspaceBrowser.statusUnknown')}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
              {reordering && pinned && (
                <View style={styles.row}>
                  {([-1, 1] as const).map(direction => (
                    <TouchableOpacity
                      key={direction}
                      style={styles.action}
                      accessibilityLabel={t(
                        direction === -1
                          ? 'workspaceBrowser.moveUp'
                          : 'workspaceBrowser.moveDown',
                        { name: item.name },
                      )}
                      disabled={
                        preferences.pins.indexOf(key) ===
                        (direction === -1 ? 0 : preferences.pins.length - 1)
                      }
                      onPress={() =>
                        useWorkspaceBrowserStore
                          .getState()
                          .movePin(serverKey, item, direction)
                      }
                    >
                      <Text style={styles.accent}>
                        {direction === -1 ? '↑' : '↓'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity
                testID={`workspace-pin-${item.profileId}-${item.workspaceId}`}
                style={styles.action}
                accessibilityRole="button"
                accessibilityLabel={t(
                  pinned ? 'workspaceBrowser.unpin' : 'workspaceBrowser.pin',
                  { name: item.name },
                )}
                accessibilityState={{ selected: pinned }}
                onPress={() =>
                  useWorkspaceBrowserStore.getState().togglePin(serverKey, item)
                }
              >
                <Text style={pinned ? styles.accent : styles.hint}>
                  {pinned ? '★' : '☆'}
                </Text>
              </TouchableOpacity>
            </View>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            {preferences.mode === 'pinned' && !preferences.pins.length ? (
              <>
                <Text style={styles.text}>{t('workspaceBrowser.noPins')}</Text>
                <TouchableOpacity
                  style={styles.action}
                  onPress={() => configure({ mode: 'all' })}
                >
                  <Text style={styles.accent}>
                    {t('workspaceBrowser.chooseWork')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : preferences.query ||
              preferences.profileId ||
              preferences.mode === 'pinned' ? (
              <Text style={styles.hint}>{t('workspaceBrowser.noMatch')}</Text>
            ) : (
              emptyState ?? (
                <Text style={styles.hint}>{t('workspaceBrowser.noMatch')}</Text>
              )
            )}
            {!!selectedProfile && (
              <TouchableOpacity
                style={styles.action}
                disabled={!!pending}
                onPress={() => openProfile(selectedProfile.id)}
              >
                <Text style={styles.accent}>
                  {t('workspaceBrowser.openProfile')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
      <Modal
        visible={picker}
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <SafeAreaView style={styles.root}>
          <View style={styles.toolbar}>
            <View style={styles.row}>
              <Text style={[styles.name, styles.flex]}>
                {t('workspaceBrowser.profiles')}
              </Text>
              <TouchableOpacity
                style={styles.action}
                onPress={() => setPicker(false)}
              >
                <Text style={styles.accent}>
                  {t('workspaceList.button.close')}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>{t('workspaceBrowser.profileHint')}</Text>
            <TextInput
              style={styles.search}
              value={profileQuery}
              onChangeText={setProfileQuery}
              placeholder={t('workspaceBrowser.searchProfiles')}
              accessibilityLabel={t('workspaceBrowser.searchProfiles')}
              placeholderTextColor={appColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.action}
              onPress={() => chooseFilter(null)}
            >
              <Text style={styles.accent}>
                {t('workspaceBrowser.allProfiles')}
              </Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={filteredProfiles}
            keyExtractor={profile => profile.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>
                {t(
                  profiles.length
                    ? 'workspaceBrowser.noMatch'
                    : 'workspaceList.diagnostic.noProfilesBody',
                )}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.workspace}>
                <TouchableOpacity
                  testID={`profile-filter-${item.id}`}
                  style={styles.destination}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: preferences.profileId === item.id,
                  }}
                  onPress={() => chooseFilter(item.id)}
                >
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name || item.id}
                  </Text>
                  <Text style={styles.hint}>
                    {t(
                      item.type === 'remote'
                        ? 'workspaceBrowser.remote'
                        : 'workspaceBrowser.local',
                    )}
                    {item.id === activeLocalProfileId
                      ? ` · ${t('workspaceList.profile.active')}`
                      : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`profile-open-${item.id}`}
                  style={styles.action}
                  disabled={!!pending}
                  onPress={() => openProfile(item.id)}
                >
                  <Text style={styles.accent}>
                    {t('workspaceBrowser.openProfile')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: appColors.background },
  toolbar: {
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  text: { color: appColors.text, fontSize: fontSize.sm },
  accent: { color: appColors.accent, fontSize: fontSize.sm },
  hint: { color: appColors.textMuted, fontSize: fontSize.xs },
  error: { color: appColors.error, fontSize: fontSize.sm },
  tab: {
    paddingHorizontal: spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 8,
  },
  selected: {
    backgroundColor: appColors.surface,
    borderWidth: 1,
    borderColor: appColors.accent,
  },
  filter: {
    flex: 1,
    alignItems: 'flex-end',
    minHeight: 40,
    justifyContent: 'center',
  },
  search: {
    color: appColors.text,
    backgroundColor: appColors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    fontSize: fontSize.sm,
  },
  list: { padding: spacing.sm, paddingBottom: spacing.lg },
  workspace: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: appColors.border,
    borderRadius: 8,
    backgroundColor: appColors.surface,
    marginBottom: spacing.xs,
  },
  current: { borderLeftWidth: 3, borderLeftColor: appColors.accent },
  destination: {
    flex: 1,
    minWidth: 0,
    padding: spacing.sm,
    gap: spacing.xs,
    minHeight: 64,
  },
  name: { color: appColors.text, fontSize: fontSize.md, fontWeight: '700' },
  source: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    maxWidth: '40%',
  },
  action: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    padding: spacing.md,
    color: appColors.textMuted,
    alignItems: 'center',
    gap: spacing.sm,
  },
})
