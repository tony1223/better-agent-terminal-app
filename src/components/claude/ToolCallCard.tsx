/**
 * ToolCallCard - Renders a Claude tool call with status and expandable details
 */

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { ClaudeToolCall } from '@/types'

interface Props {
  tool: ClaudeToolCall
}

export const ToolCallCard = React.memo(function ToolCallCard({ tool }: Props) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = tool.status === 'running' ? null
    : tool.status === 'completed' ? '\u2713'
    : '\u2717'

  const statusColor = tool.status === 'running' ? appColors.accent
    : tool.status === 'completed' ? appColors.success
    : appColors.error

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        {tool.status === 'running' ? (
          <ActivityIndicator size="small" color={appColors.accent} style={styles.spinner} />
        ) : (
          <Text style={[styles.statusIcon, { color: statusColor }]}>{statusIcon}</Text>
        )}
        <Text style={styles.toolName} numberOfLines={1}>{tool.toolName}</Text>
        <Text style={styles.expand}>{expanded ? '\u25BC' : '\u25B6'}</Text>
      </View>

      {tool.description && (
        <Text style={styles.description} numberOfLines={expanded ? undefined : 1}>
          {tool.description}
        </Text>
      )}

      {expanded && (
        <View style={styles.details}>
          <Text style={styles.detailLabel}>Input:</Text>
          <Text style={styles.detailCode}>
            {JSON.stringify(tool.input, null, 2)}
          </Text>

          {tool.result && (
            <>
              <Text style={styles.detailLabel}>Result:</Text>
              <Text style={styles.detailCode} numberOfLines={20}>
                {tool.result}
              </Text>
            </>
          )}
        </View>
      )}
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  container: {
    backgroundColor: appColors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: appColors.border,
    borderLeftWidth: 3,
    borderLeftColor: appColors.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: spacing.sm,
  },
  statusIcon: {
    fontSize: fontSize.md,
    marginRight: spacing.sm,
    fontWeight: '700',
  },
  toolName: {
    flex: 1,
    fontSize: fontSize.sm,
    color: appColors.text,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  expand: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
  },
  description: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    marginTop: spacing.xs,
  },
  details: {
    marginTop: spacing.md,
  },
  detailLabel: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
    marginTop: spacing.sm,
  },
  detailCode: {
    fontSize: fontSize.xs,
    color: appColors.text,
    fontFamily: 'monospace',
    backgroundColor: appColors.background,
    borderRadius: 6,
    padding: spacing.sm,
  },
})
