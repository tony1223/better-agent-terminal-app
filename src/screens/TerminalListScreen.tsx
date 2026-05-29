/**
 * TerminalListScreen - List terminals in the active workspace
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  View,
  Text,
  FlatList,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { getAgentPreset, normalizeAgentPresetsFromHost } from '@/types'
import type { AgentPreset, AgentPresetId, TerminalInstance } from '@/types'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

const SDK_AGENT_PRESETS = new Set(['claude-code', 'claude-code-v2', 'claude-code-worktree', 'codex-agent', 'codex-agent-worktree', 'openai-agent'])

export function TerminalListScreen({ navigation }: Props) {
  const { t } = useTranslation()
  const channels = useConnectionStore(s => s.channels)
  const {
    activeWorkspaceId,
    workspaces,
    terminals,
    setActiveTerminal,
    requestAddSession,
    requestCloseSession,
  } = useWorkspaceStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [availableSessionTypes, setAvailableSessionTypes] = useState<AgentPreset[] | null>(null)
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [creatingType, setCreatingType] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)
  const createRequestRef = useRef(0)
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  const workspaceTerminals = terminals.filter(
    item => item.workspaceId === activeWorkspaceId
  )
  const sessionTypeRows = useMemo(() => availableSessionTypes ?? [], [availableSessionTypes])

  const loadSupportedSessionTypes = useCallback(async () => {
    if (!channels) return
    setLoadingTypes(true)
    try {
      const presets = await channels.agent.listPresets()
        .then(normalizeAgentPresetsFromHost)
        .catch(() => [])
      if (presets.length > 0) {
        setAvailableSessionTypes(presets)
        return
      }

      const ids = await channels.agent.getSupportedSessionTypes()
      setAvailableSessionTypes(normalizeAgentPresetsFromHost(ids))
    } catch (e) {
      setAvailableSessionTypes([])
      Alert.alert(t('terminalList.alerts.loadTypesFailedTitle'), String(e))
    } finally {
      setLoadingTypes(false)
    }
  }, [channels, t])

  useEffect(() => { loadSupportedSessionTypes() }, [loadSupportedSessionTypes])

  const handlePress = (terminal: TerminalInstance) => {
    setActiveTerminal(terminal.id)
    if (terminal.agentPreset && SDK_AGENT_PRESETS.has(terminal.agentPreset)) {
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
            setClosingId(terminal.id)
            try {
              await requestCloseSession(terminal.id)
            } catch (e) {
              Alert.alert(t('terminalList.alerts.closeFailedTitle'), String(e))
            } finally {
              setClosingId(null)
            }
          },
        },
      ],
    )
  }

  const renderTerminal = ({ item }: { item: TerminalInstance }) => {
    const preset = item.agentPreset ? getAgentPreset(item.agentPreset) : null
    const isClosing = closingId === item.id

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handlePress(item)}
        disabled={isClosing}
      >
        <View style={styles.row}>
          {preset && (
            <Text style={[styles.icon, { color: preset.color }]}>
              {preset.icon}
            </Text>
          )}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {item.alias || item.title}
            </Text>
            <Text style={styles.cwd} numberOfLines={1}>
              {item.cwd}
            </Text>
          </View>
          <View style={[styles.statusDot, {
            backgroundColor: item.pid ? appColors.success : appColors.textMuted,
          }]} />
          {isClosing ? (
            <ActivityIndicator size="small" color={appColors.accent} style={styles.closeSpinner} />
          ) : (
            <TouchableOpacity style={styles.closeButton} onPress={() => closeSession(item)}>
              <Text style={styles.closeButtonText}>{t('terminalList.button.close')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      {activeWorkspaceId && (
        <View style={styles.sessionToolbar}>
          <Text style={styles.sessionToolbarTitle}>{t('terminalList.title')}</Text>
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
        </View>
      )}
      <FlatList
        data={workspaceTerminals}
        keyExtractor={(item) => item.id}
        renderItem={renderTerminal}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {activeWorkspaceId
              ? t('terminalList.empty.noTerminals')
              : t('terminalList.empty.noWorkspace')}
          </Text>
        }
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
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  sessionToolbarTitle: {
    flex: 1,
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '800',
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
  cwd: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  closeSpinner: {
    marginLeft: spacing.sm,
  },
  closeButton: {
    minHeight: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    marginLeft: spacing.sm,
  },
  closeButtonText: {
    color: appColors.error,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  headerButton: {
    minHeight: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.border,
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
