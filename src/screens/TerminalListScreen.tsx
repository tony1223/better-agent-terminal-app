/**
 * TerminalListScreen - the phone's list of open sessions.
 *
 * Defaults to every workspace, grouped, with the active one first. Filtering to
 * the active workspace (the old behaviour) meant a session running somewhere
 * else was three navigations away — Workspaces, pick, back to this tab — which
 * is exactly the "can I quickly get to the other thing" case a phone is worst at.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  View,
  Text,
  FlatList,
  Modal,
  SectionList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFocusEffect } from '@react-navigation/native'
import { useConnectionStore } from '@/stores/connection-store'
import { useSupportedSessionTypes } from '@/hooks/use-supported-session-types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useRecentsStore } from '@/stores/recents-store'
import { useSessionPreviewStore } from '@/stores/session-preview-store'
import { SessionRow } from '@/components/session/SessionRow'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { isSdkAgentSession } from '@/types'
import type { AgentPresetId, TerminalInstance } from '@/types'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

type Scope = 'workspace' | 'all'

export function TerminalListScreen({ navigation }: Props) {
  const { t } = useTranslation()
  const connectionStatus = useConnectionStore(s => s.status)
  const {
    activeWorkspaceId,
    workspaces,
    terminals,
    setActiveTerminal,
    switchWorkspace,
    requestAddSession,
    requestCloseSession,
  } = useWorkspaceStore()
  const [scope, setScope] = useState<Scope>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const { availableSessionTypes, loadingTypes, loadSupportedSessionTypes } =
    useSupportedSessionTypes(t('terminalList.alerts.loadTypesFailedTitle'))
  const [creatingType, setCreatingType] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const createRequestRef = useRef(0)
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  const visibleTerminals = useMemo(
    () => (scope === 'all'
      ? terminals
      : terminals.filter(item => item.workspaceId === activeWorkspaceId)),
    [scope, terminals, activeWorkspaceId],
  )

  const sections = useMemo(() => {
    if (scope !== 'all') {
      return [{ workspaceId: activeWorkspaceId ?? '', title: '', data: visibleTerminals }]
    }
    const byWorkspace = new Map<string, TerminalInstance[]>()
    for (const item of terminals) {
      const list = byWorkspace.get(item.workspaceId)
      if (list) list.push(item)
      else byWorkspace.set(item.workspaceId, [item])
    }
    return [...byWorkspace.entries()]
      .map(([workspaceId, data]) => {
        const workspace = workspaces.find(w => w.id === workspaceId)
        return { workspaceId, title: workspace?.alias || workspace?.name || workspaceId, data }
      })
      .sort((a, b) => {
        // The workspace you were last in goes first; it's the one you most
        // likely came back for, and on a phone the top of the list is the
        // only part you see without scrolling.
        if (a.workspaceId === activeWorkspaceId) return -1
        if (b.workspaceId === activeWorkspaceId) return 1
        return a.title.localeCompare(b.title)
      })
  }, [scope, terminals, workspaces, activeWorkspaceId, visibleTerminals])

  const sessionTypeRows = useMemo(() => availableSessionTypes ?? [], [availableSessionTypes])

  // Taken from `sections`, not the raw list, so the active workspace's rows are
  // fetched first — previews are pulled a few at a time and the top of the list
  // is the part you can actually see.
  //
  // A stable dependency for "the set of SDK sessions changed" — the array
  // itself is a new ref every render, so the key is what the effect can watch.
  const sdkSessionIds = useMemo(
    () => sections.flatMap(section => section.data.filter(isSdkAgentSession).map(item => item.id)),
    [sections],
  )
  const sdkSessionIdsKey = sdkSessionIds.join('\0')

  const loadPreviews = useCallback(() => {
    useSessionPreviewStore.getState().load(sdkSessionIds).catch(() => undefined)
    // sdkSessionIdsKey stands in for the array's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkSessionIdsKey])

  useEffect(() => {
    if (connectionStatus === 'connected') loadPreviews()
  }, [connectionStatus, loadPreviews])

  // Refresh terminals on focus so sessions started elsewhere show up without
  // relying on cached state. Previews need no staleness window — an opening
  // prompt doesn't change, so the store only fetches ids it has never seen.
  // Activity isn't fetched at all: it rides the stream events App.tsx already
  // subscribes to, so a session that starts working updates the row live.
  useFocusEffect(
    useCallback(() => {
      useWorkspaceStore.getState().load()
      loadPreviews()
    }, [loadPreviews]),
  )

  const handlePress = (terminal: TerminalInstance) => {
    // Opening a session from another workspace makes that workspace the one
    // you're in — otherwise the footer and the Add button would still point at
    // whichever workspace you happened to leave behind.
    if (terminal.workspaceId && terminal.workspaceId !== activeWorkspaceId) {
      switchWorkspace(terminal.workspaceId)
    }
    setActiveTerminal(terminal.id)
    const recents = useRecentsStore.getState()
    recents.touchSession(terminal.id)
    if (terminal.workspaceId) recents.touchWorkspace(terminal.workspaceId)
    if (isSdkAgentSession(terminal)) {
      navigation.navigate('Claude', { sessionId: terminal.id })
    } else {
      navigation.navigate('Terminal', { terminalId: terminal.id })
    }
  }

  const addSession = async (presetId: string) => {
    if (!activeWorkspaceId) return
    const agentPreset = presetId === 'none' ? undefined : presetId as AgentPresetId
    const requestId = createRequestRef.current + 1
    createRequestRef.current = requestId
    setCreatingType(presetId)
    try {
      const terminal = await requestAddSession(activeWorkspaceId, agentPreset)
      if (createRequestRef.current !== requestId) {
        try {
          await requestCloseSession(terminal.id)
        } catch (cancelError) {
          Alert.alert(t('terminalList.alerts.cancelFailedTitle'), String(cancelError))
        }
        return
      }
      setShowAddModal(false)
      handlePress(terminal)
    } catch (e) {
      if (createRequestRef.current === requestId) {
        Alert.alert(t('terminalList.alerts.addFailedTitle'), String(e))
      }
    } finally {
      if (createRequestRef.current === requestId) {
        setCreatingType(null)
      }
    }
  }

  const dismissAddModal = () => {
    if (creatingType) {
      createRequestRef.current += 1
      setCreatingType(null)
    }
    setShowAddModal(false)
  }

  const closeSessionNow = async (terminal: TerminalInstance, options?: { cleanWorktree?: boolean }) => {
    setClosingId(terminal.id)
    try {
      await requestCloseSession(terminal.id, options)
      useRecentsStore.getState().forgetSession(terminal.id)
    } finally {
      setClosingId(null)
    }
  }

  const closeSession = (terminal: TerminalInstance) => {
    Alert.alert(
      t('terminalList.alerts.closeTitle'),
      t('terminalList.alerts.closeMessage', { name: terminal.alias || terminal.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('terminalList.button.close'),
          style: 'destructive',
          onPress: async () => {
            try {
              await closeSessionNow(terminal)
            } catch (e) {
              Alert.alert(t('terminalList.alerts.closeFailedTitle'), String(e))
            }
          },
        },
      ],
    )
  }

  const emptyMessage = scope === 'all'
    ? t('terminalList.empty.noSessionsAnywhere')
    : activeWorkspaceId
      ? t('terminalList.empty.noTerminals')
      : t('terminalList.empty.noWorkspace')

  return (
    <View style={styles.container}>
      <View style={styles.sessionToolbar}>
        <Text style={styles.sessionToolbarTitle}>{t('terminalList.title')}</Text>
        {activeWorkspaceId && (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => {
              setShowAddModal(true)
              if (!availableSessionTypes) {
                loadSupportedSessionTypes().catch(() => undefined)
              }
            }}
          >
            <Text style={styles.headerButtonText}>{t('terminalList.button.add')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.scopeBar}>
        {(['workspace', 'all'] as Scope[]).map(option => (
          <TouchableOpacity
            key={option}
            style={[styles.scopeTab, scope === option && styles.scopeTabActive]}
            onPress={() => setScope(option)}
          >
            <Text style={[styles.scopeText, scope === option && styles.scopeTextActive]}>
              {t(`terminalList.scope.${option}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          section.title ? <Text style={styles.sectionHeader}>{section.title}</Text> : null
        )}
        renderItem={({ item }) => (
          <SessionRow
            terminal={item}
            closing={closingId === item.id}
            onPress={handlePress}
            onRequestClose={closeSession}
            onCloseSession={closeSessionNow}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
      />
      {activeWorkspace && (
        <View style={styles.workspaceBar}>
          <Text style={styles.workspaceBarLabel}>{t('terminalList.label.workspace')}</Text>
          <Text style={styles.workspaceBarName} numberOfLines={1}>
            {activeWorkspace.alias || activeWorkspace.name}
          </Text>
        </View>
      )}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={dismissAddModal}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('terminalList.modal.title')}</Text>
            <TouchableOpacity style={styles.headerButton} onPress={dismissAddModal}>
              <Text style={styles.headerButtonText}>{creatingType ? t('common.cancel') : t('terminalList.button.close')}</Text>
            </TouchableOpacity>
          </View>
          {loadingTypes && sessionTypeRows.length === 0 ? (
            <View style={styles.loadingPane}>
              <ActivityIndicator color={appColors.accent} />
            </View>
          ) : (
            <FlatList
              data={sessionTypeRows}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isCreating = creatingType === item.id
                return (
                  <TouchableOpacity
                    style={styles.card}
                    disabled={!!creatingType}
                    onPress={() => addSession(item.id)}
                  >
                    <View style={styles.row}>
                      <Text style={[styles.icon, { color: item.color }]}>{item.icon}</Text>
                      <View style={styles.info}>
                        <Text style={styles.title}>{item.name}</Text>
                      </View>
                      {isCreating && <ActivityIndicator size="small" color={appColors.accent} />}
                    </View>
                  </TouchableOpacity>
                )
              }}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.empty}>{t('terminalList.empty.noSessionTypes')}</Text>}
            />
          )}
        </View>
      </Modal>
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
  },
  sessionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: appColors.surface,
  },
  sessionToolbarTitle: {
    flex: 1,
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  scopeBar: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  scopeTab: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: appColors.background,
  },
  scopeTabActive: {
    backgroundColor: appColors.accentDim,
  },
  scopeText: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  scopeTextActive: {
    color: appColors.text,
  },
  sectionHeader: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: fontSize.xl,
    marginRight: spacing.md,
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: fontSize.md,
    color: appColors.text,
    fontWeight: '600',
  },
  headerButton: {
    minHeight: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
    backgroundColor: appColors.surfaceHover,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  headerButtonText: {
    color: appColors.accent,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    paddingTop: spacing.xl,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  modalTitle: {
    flex: 1,
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  loadingPane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: fontSize.md,
    color: appColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  workspaceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: appColors.surface,
    borderTopWidth: 1,
    borderTopColor: appColors.border,
  },
  workspaceBarLabel: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    marginRight: spacing.sm,
  },
  workspaceBarName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: appColors.accent,
    fontWeight: '600',
  },
})
