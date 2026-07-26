/**
 * One session, rendered the same way everywhere it appears.
 *
 * TerminalListScreen and the workspace detail's sessions pane had grown two
 * different rows for the same object — one with a preview and a pid dot, one
 * with neither — so which screen you arrived from decided how much you were
 * told about a session.
 */

import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { WorktreeControls } from '@/components/session/WorktreeControls'
import { appColors, fontSize, spacing } from '@/theme/colors'
import { getAgentPreset, isSdkAgentSession, type TerminalInstance } from '@/types'
import {
  deriveAgentActivity,
  derivePtyActivity,
  runtimePhaseLabel,
  type SessionActivity,
} from '@/utils/session-status'
import { useClaudeStore } from '@/stores/claude-store'
import { useSessionPreviewStore } from '@/stores/session-preview-store'

interface Props {
  terminal: TerminalInstance
  closing: boolean
  onPress: (terminal: TerminalInstance) => void
  onRequestClose: (terminal: TerminalInstance) => void
  onCloseSession: (terminal: TerminalInstance, options?: { cleanWorktree?: boolean }) => Promise<void>
  /** Shown above the title when the list spans workspaces. */
  contextLabel?: string
}

const ACTIVITY_TONE: Record<SessionActivity, { color: string; labelKey: string }> = {
  working: { color: appColors.warning, labelKey: 'session.activity.working' },
  idle: { color: appColors.success, labelKey: 'session.activity.ready' },
  stopped: { color: appColors.textMuted, labelKey: 'session.activity.stopped' },
}

export function SessionRow({
  terminal,
  closing,
  onPress,
  onRequestClose,
  onCloseSession,
  contextLabel,
}: Props) {
  const { t } = useTranslation()
  const preset = terminal.agentPreset ? getAgentPreset(terminal.agentPreset) : null

  // Two primitive selectors rather than one for the whole session: a streaming
  // turn rewrites `messages` and `streamingText` continuously, and a list has no
  // business re-rendering on every token. These two only change at turn edges.
  const isStreaming = useClaudeStore(s => s.sessions[terminal.id]?.isStreaming ?? false)
  const runtimeStatus = useClaudeStore(s => s.sessions[terminal.id]?.meta?.runtimeStatus ?? null)
  const preview = useSessionPreviewStore(s => s.previews[terminal.id])

  // A plain shell has no agent turn to report, so its process really is the
  // whole story; only SDK sessions have live agent activity to consult.
  const live = { isStreaming, meta: { runtimeStatus } }
  const activity: SessionActivity = isSdkAgentSession(terminal)
    ? deriveAgentActivity(live)
    : derivePtyActivity(terminal)
  const tone = ACTIVITY_TONE[activity]
  // The host's phase word ("queued", "compacting") beats a generic "Working"
  // when it has one — it's the difference between "busy" and "stuck on me".
  const activityLabel = (activity === 'working' && runtimePhaseLabel(live)) || t(tone.labelKey)

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(terminal)} disabled={closing}>
      <View style={styles.row}>
        <Text style={[styles.icon, preset ? { color: preset.color } : null]}>
          {preset?.icon || '>'}
        </Text>
        <View style={styles.info}>
          {contextLabel ? (
            <Text style={styles.context} numberOfLines={1}>{contextLabel}</Text>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {terminal.alias || terminal.title}
          </Text>
          <Text style={styles.cwd} numberOfLines={1}>{terminal.cwd}</Text>
          {preview ? (
            <Text style={styles.preview} numberOfLines={2}>{preview}</Text>
          ) : null}
        </View>
        {closing ? (
          <ActivityIndicator size="small" color={appColors.accent} style={styles.trailing} />
        ) : (
          <TouchableOpacity style={styles.closeButton} onPress={() => onRequestClose(terminal)}>
            <Text style={styles.closeButtonText}>{t('terminalList.button.close')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
        <Text style={[styles.statusText, { color: tone.color }]} numberOfLines={1}>
          {activityLabel}
        </Text>
      </View>
      <WorktreeControls terminal={terminal} closing={closing} onCloseSession={onCloseSession} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
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
    color: appColors.accent,
    fontSize: fontSize.xl,
    marginRight: spacing.md,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  context: {
    fontSize: fontSize.xs,
    color: appColors.accent,
    fontWeight: '700',
    marginBottom: 2,
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
  preview: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    marginTop: spacing.xs,
    lineHeight: fontSize.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  trailing: {
    marginLeft: spacing.sm,
  },
  closeButton: {
    minHeight: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.borderStrong,
    backgroundColor: appColors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginLeft: spacing.sm,
  },
  closeButtonText: {
    color: appColors.error,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
})
