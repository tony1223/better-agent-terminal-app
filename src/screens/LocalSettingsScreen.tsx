/**
 * LocalSettingsScreen - device-local app settings available before connecting.
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
import { appColors, spacing, fontSize } from '@/theme/colors'
import {
  getDebugLogText,
  clearDebugLogs,
  isDebugMode,
  setDebugMode,
  dlog,
} from '@/utils/debug-log'

export function LocalSettingsScreen() {
  const insets = useSafeAreaInsets()
  const [debugEnabled, setDebugEnabled] = useState(isDebugMode)
  const [showLogViewer, setShowLogViewer] = useState(false)

  const handleToggleDebug = (value: boolean) => {
    setDebugEnabled(value)
    setDebugMode(value)
    dlog('!DEBUG', `debug mode ${value ? 'enabled' : 'disabled'} from local settings`)
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      >
        <Text style={styles.sectionTitle}>Diagnostics</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchTextBlock}>
              <Text style={styles.switchLabel}>Debug Logs</Text>
              <Text style={styles.switchHint}>
                {debugEnabled
                  ? 'Verbose logging is enabled for connection and remote events.'
                  : 'Only errors are logged. Enable before reproducing a connection issue.'}
              </Text>
            </View>
            <Switch
              value={debugEnabled}
              onValueChange={handleToggleDebug}
              trackColor={{ false: appColors.border, true: appColors.accent }}
              thumbColor="#fff"
            />
          </View>

          <TouchableOpacity style={styles.actionRow} onPress={() => setShowLogViewer(true)}>
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
      </ScrollView>

      <Modal visible={showLogViewer} animationType="slide" onRequestClose={() => setShowLogViewer(false)}>
        <View style={styles.logViewerContainer}>
          <View style={styles.logViewerHeader}>
            <Text style={styles.logViewerTitle}>Debug Logs</Text>
            <TouchableOpacity onPress={() => setShowLogViewer(false)}>
              <Text style={styles.logViewerClose}>Close</Text>
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
    borderRadius: 8,
    marginHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  switchRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: appColors.border,
  },
  switchTextBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  switchLabel: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  switchHint: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginTop: spacing.xs,
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
    fontWeight: '700',
  },
  logViewerContainer: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  logViewerHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: appColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: appColors.border,
  },
  logViewerTitle: {
    color: appColors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  logViewerClose: {
    color: appColors.accent,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  logViewerBody: {
    flex: 1,
    padding: spacing.md,
  },
  logViewerText: {
    color: appColors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
})
