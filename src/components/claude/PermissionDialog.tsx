/**
 * PermissionDialog - Modal for claude:permission-request events
 */

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useClaudeStore } from '@/stores/claude-store'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing, fontSize } from '@/theme/colors'

export function PermissionDialog() {
  const pending = useClaudeStore(s => s.pendingPermission)
  const clearPermission = useClaudeStore(s => s.clearPermission)
  const channels = useConnectionStore(s => s.channels)
  const [showInput, setShowInput] = useState(false)

  if (!pending) return null

  const handleAllow = async () => {
    if (!channels) return
    await channels.claude.resolvePermission(pending.sessionId, pending.toolUseId, {
      behavior: 'allow',
    })
    clearPermission()
  }

  const handleDeny = async () => {
    if (!channels) return
    await channels.claude.resolvePermission(pending.sessionId, pending.toolUseId, {
      behavior: 'deny',
    })
    clearPermission()
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.dialog}>
        <Text style={styles.title}>Permission Required</Text>

        <Text style={styles.toolName}>{pending.toolName}</Text>

        {pending.decisionReason && (
          <Text style={styles.reason}>{pending.decisionReason}</Text>
        )}

        <TouchableOpacity
          style={styles.inputToggle}
          onPress={() => setShowInput(!showInput)}
        >
          <Text style={styles.inputToggleText}>
            {showInput ? '\u25BC Input details' : '\u25B6 Input details'}
          </Text>
        </TouchableOpacity>

        {showInput && (
          <ScrollView style={styles.inputScroll}>
            <Text style={styles.inputCode}>
              {JSON.stringify(pending.input, null, 2)}
            </Text>
          </ScrollView>
        )}

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.denyButton} onPress={handleDeny}>
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.allowButton} onPress={handleAllow}>
            <Text style={styles.allowText}>Allow</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  dialog: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: spacing.xl,
    width: '85%',
    maxHeight: '70%',
  },
  title: {
    fontSize: fontSize.xl,
    color: appColors.warning,
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  toolName: {
    fontSize: fontSize.md,
    color: appColors.text,
    fontFamily: 'monospace',
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  reason: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    marginBottom: spacing.md,
  },
  inputToggle: {
    marginBottom: spacing.sm,
  },
  inputToggleText: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
  },
  inputScroll: {
    maxHeight: 150,
    backgroundColor: appColors.background,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  inputCode: {
    fontSize: fontSize.xs,
    color: appColors.text,
    fontFamily: 'monospace',
  },
  buttons: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  denyButton: {
    flex: 1,
    backgroundColor: appColors.errorDim,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  denyText: {
    color: appColors.error,
    fontWeight: '700',
    fontSize: fontSize.md,
  },
  allowButton: {
    flex: 1,
    backgroundColor: appColors.successDim,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  allowText: {
    color: appColors.success,
    fontWeight: '700',
    fontSize: fontSize.md,
  },
})
