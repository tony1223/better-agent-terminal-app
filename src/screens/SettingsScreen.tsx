/**
 * SettingsScreen - Connection info, profile, hosts, appearance
 */

import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConnectionStore } from '@/stores/connection-store'
import { useHostStore } from '@/stores/host-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { getDebugLogText, clearDebugLogs } from '@/utils/debug-log'

export function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const { status, host, port, disconnect } = useConnectionStore()
  const activeHostId = useHostStore(s => s.activeHostId)
  const hosts = useHostStore(s => s.hosts)
  const activeHost = hosts.find(h => h.id === activeHostId)
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

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

  return (
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
  },
  actionText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
})
