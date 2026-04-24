/**
 * WorkspaceListScreen - List and switch workspaces
 */

import React, { useEffect } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { getAgentPreset } from '@/types'
import type { Workspace } from '@/types'

export function WorkspaceListScreen() {
  const { workspaces, activeWorkspaceId, load, switchWorkspace } = useWorkspaceStore()
  const navigation = useNavigation<any>()
  const [refreshing, setRefreshing] = React.useState(false)

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const renderWorkspace = ({ item }: { item: Workspace }) => {
    const isActive = item.id === activeWorkspaceId
    const preset = item.defaultAgent ? getAgentPreset(item.defaultAgent) : null

    return (
      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={() => {
          switchWorkspace(item.id)
          navigation.navigate('Terminals')
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
        data={workspaces}
        keyExtractor={(item) => item.id}
        renderItem={renderWorkspace}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={appColors.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No workspaces found.</Text>
        }
      />
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
})
