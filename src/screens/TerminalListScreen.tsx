/**
 * TerminalListScreen - List terminals in the active workspace
 */

import React from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { getAgentPreset } from '@/types'
import type { TerminalInstance } from '@/types'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

export function TerminalListScreen({ navigation }: Props) {
  const { activeWorkspaceId, workspaces, terminals, setActiveTerminal } = useWorkspaceStore()
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  const workspaceTerminals = terminals.filter(
    t => t.workspaceId === activeWorkspaceId
  )

  const handlePress = (terminal: TerminalInstance) => {
    setActiveTerminal(terminal.id)
    if (terminal.agentPreset === 'claude-code') {
      // Claude Code terminals go directly to Claude chat screen
      navigation.navigate('Claude', { sessionId: terminal.id })
    } else {
      navigation.navigate('Terminal', { terminalId: terminal.id })
    }
  }

  const renderTerminal = ({ item }: { item: TerminalInstance }) => {
    const preset = item.agentPreset ? getAgentPreset(item.agentPreset) : null

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handlePress(item)}
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
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={workspaceTerminals}
        keyExtractor={(item) => item.id}
        renderItem={renderTerminal}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {activeWorkspaceId
              ? 'No terminals in this workspace.'
              : 'Select a workspace first.'}
          </Text>
        }
      />
      {activeWorkspace && (
        <View style={styles.workspaceBar}>
          <Text style={styles.workspaceBarLabel}>Workspace</Text>
          <Text style={styles.workspaceBarName} numberOfLines={1}>
            {activeWorkspace.alias || activeWorkspace.name}
          </Text>
        </View>
      )}
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
