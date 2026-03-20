/**
 * ToolCallCard - Renders a Claude tool call with status and expandable details
 * Matches BAT Desktop timeline-dot style
 */

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native'
import { LinkedText } from './LinkedText'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { ClaudeToolCall } from '@/types'

interface Props {
  tool: ClaudeToolCall
}

/** Compact one-line summary of tool input (matches desktop toolInputSummary) */
function toolInputSummary(input: Record<string, unknown>): string {
  if (input.command) return String(input.command).slice(0, 120)
  if (input.file_path) return String(input.file_path)
  if (input.pattern) return String(input.pattern)
  if (input.query) return String(input.query).slice(0, 120)
  if (input.url) return String(input.url)
  if (input.prompt) return String(input.prompt).slice(0, 120)
  return ''
}

export const ToolCallCard = React.memo(function ToolCallCard({ tool }: Props) {
  const [expanded, setExpanded] = useState(false)

  const dotColor = tool.denied ? appColors.error
    : tool.status === 'running' ? appColors.accent
    : tool.status === 'completed' ? '#10b981'
    : appColors.error

  // Description from input.description, or fall back to input summary
  const desc = tool.input?.description ? String(tool.input.description) : null
  const summary = desc || toolInputSummary(tool.input)

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.toolName}>{tool.toolName}</Text>
        {summary ? (
          <LinkedText text={summary} style={styles.summary} />
        ) : null}
        <Text style={styles.expand}>{expanded ? '\u25BC' : '\u25B6'}</Text>
      </View>

      {expanded && (
        <View style={styles.details}>
          <Text style={styles.detailLabel}>Input:</Text>
          <Text style={styles.detailCode}>
            {JSON.stringify(tool.input, null, 2)}
          </Text>

          {tool.result && (
            <>
              <Text style={styles.detailLabel}>Result:</Text>
              <LinkedText text={tool.result} style={styles.detailCode} />
            </>
          )}
        </View>
      )}
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    minHeight: 40,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  toolName: {
    fontSize: fontSize.sm,
    color: appColors.accent,
    fontWeight: '600',
    fontFamily: 'monospace',
    marginRight: spacing.sm,
  },
  summary: {
    flex: 1,
    fontSize: fontSize.sm,
    color: '#bbb',
    fontFamily: 'monospace',
    minWidth: 0,
  },
  expand: {
    fontSize: fontSize.xs,
    color: appColors.textSecondary,
    marginLeft: spacing.sm,
  },
  details: {
    marginTop: spacing.sm,
    marginLeft: 16, // align with text after dot
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
