/**
 * SettingsScreen - Connection info, profile, hosts, appearance, debug
 */

import React, { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  Switch,
  Modal,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConnectionStore } from '@/stores/connection-store'
import { useHostStore } from '@/stores/host-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import {
  getDebugLogText,
  clearDebugLogs,
  isDebugMode,
  setDebugMode,
} from '@/utils/debug-log'

export function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const { status, host, port, disconnect } = useConnectionStore()
  const activeHostId = useHostStore(s => s.activeHostId)
  const hosts = useHostStore(s => s.hosts)
  const activeHost = hosts.find(h => h.id === activeHostId)
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  const [debugEnabled, setDebugEnabled] = useState(isDebugMode)
  const [showLogViewer, setShowLogViewer] = useState(false)

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect',
      'Are you sure you want to disconnect from this host?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: disconnect },
      ]
    )
  }

  const handleToggleDebug = (value: boolean) => {
    setDebugEnabled(value)
    setDebugMode(value)
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      >
        {/* Connection Info */}
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.card}>
          <Row label="Host" value={activeHost?.name || host || '-'} />
          <Row label="Address" value={host ? `${host}:${port}` : '-'} mono />
          <Row
            label="Status"
            value={status}
            valueColor={status === 'connected' ? appColors.success : appColors.textSecondary}
          />
        </View>

        {/* Active Workspace */}
        <Text style={styles.sectionTitle}>Active Workspace</Text>
        <View style={styles.card}>
          <Row label="Name" value={activeWorkspace?.alias || activeWorkspace?.name || '-'} />
          <Row label="Path" value={activeWorkspace?.folderPath || '-'} mono />
        </View>

        {/* Actions */}
        <Text style={styles.sectionTitle}>Actions</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.actionRow} onPress={handleDisconnect}>
            <Text style={[styles.actionText, { color: appColors.error }]}>Disconnect</Text>
          </TouchableOpacity>
        </View>

        {/* Debug */}
        <Text style={styles.sectionTitle}>Debug</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Debug Mode</Text>
            <Switch
              value={debugEnabled}
              onValueChange={handleToggleDebug}
              trackColor={{ false: appColors.border, true: appColors.accent }}
              thumbColor="#fff"
            />
          </View>
          <Text style={styles.switchHint}>
            {debugEnabled
              ? 'Logging enabled — all dlog() calls write to MMKV & logcat'
              : 'Only errors are logged. Enable for full diagnostics.'}
          </Text>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setShowLogViewer(true)}
          >
            <Text style={[styles.actionText, { color: appColors.accent }]}>View Logs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {
              const logs = getDebugLogText()
              Share.share({ message: logs, title: 'BAT Mobile Debug Logs' })
            }}
          >
            <Text style={[styles.actionText, { color: appColors.info }]}>Share Debug Logs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => {
              clearDebugLogs()
              Alert.alert('Cleared', 'Debug logs have been cleared.')
            }}
          >
            <Text style={[styles.actionText, { color: appColors.textSecondary }]}>Clear Logs</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <Row label="App" value="BAT Mobile" />
          <Row label="Version" value="0.1.0" />
        </View>
      </ScrollView>

      {/* Log viewer modal */}
      <Modal visible={showLogViewer} animationType="slide" onRequestClose={() => setShowLogViewer(false)}>
        <View style={styles.logViewerContainer}>
          <View style={styles.logViewerHeader}>
            <Text style={styles.logViewerTitle}>Debug Logs</Text>
            <TouchableOpacity onPress={() => setShowLogViewer(false)}>
              <Text style={styles.logViewerClose}>{'\u2715'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.logViewerBody}>
            <Text style={styles.logViewerText} selectable>
              {getDebugLogText()}
            </Text>
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

function Row({
  label,
  value,
  mono,
  valueColor,
}: {
  label: string
  value: string
  mono?: boolean
  valueColor?: string
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono && styles.mono,
          valueColor ? { color: valueColor } : undefined,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    marginHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: appColors.border,
  },
  rowLabel: {
    fontSize: fontSize.md,
    color: appColors.text,
  },
  rowValue: {
    fontSize: fontSize.md,
    color: appColors.textSecondary,
    maxWidth: '60%',
    textAlign: 'right',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
  },
  actionRow: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: appColors.border,
  },
  actionText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  switchLabel: {
    fontSize: fontSize.md,
    color: appColors.text,
  },
  switchHint: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  // ---- Log viewer modal ----
  logViewerContainer: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  logViewerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  logViewerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: appColors.text,
  },
  logViewerClose: {
    fontSize: fontSize.xl,
    color: appColors.textSecondary,
    padding: spacing.sm,
  },
  logViewerBody: {
    flex: 1,
    padding: spacing.md,
  },
  logViewerText: {
    fontSize: fontSize.xs,
    color: appColors.text,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
})
