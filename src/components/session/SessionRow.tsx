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
import { ActivityBadge, ACTIVITY_COLOR } from './ActivityBadge'
import { useActivityClock } from '@/hooks/use-activity-clock'
import { useRecentsStore } from '@/stores/recents-store'
import { formatSessionTimestamp } from '@/utils/chat-timestamp'
import { sessionPreviewText } from '@/utils/session-preview'
import { useWorkerStore } from '@/stores/worker-store'
import { deriveWorkerActivity, isWorkerSession, procfileBasename } from '@/utils/worker'

const WORKER_ICON_COLOR = '#56b6c2'

interface Props {
  terminal: TerminalInstance
  closing: boolean
  onPress: (terminal: TerminalInstance) => void
  onRequestClose: (terminal: TerminalInstance) => void
  onCloseSession: (terminal: TerminalInstance, options?: { cleanWorktree?: boolean }) => Promise<void>
  /** Shown above the title when the list spans workspaces. */
  contextLabel?: string
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

  // Primitive selectors avoid redrawing rows for unrelated session updates.
  const isStreaming = useClaudeStore(s => s.sessions[terminal.id]?.isStreaming ?? false)
  const runtimeStatus = useClaudeStore(s => s.sessions[terminal.id]?.meta?.runtimeStatus ?? null)
  const turnStartedAt = useClaudeStore(s => s.sessions[terminal.id]?.turnStartedAt ?? null)
  const lastCompletedAt = useClaudeStore(s => s.sessions[terminal.id]?.lastCompletedAt ?? null)
  const now = useActivityClock()
  const lastDataAt = useClaudeStore(s => s.sessions[terminal.id]?.lastDataAt)
  const lastOpenedAt = useRecentsStore(s => s.sessions[terminal.id]?.lastOpenedAt)
  const dataTime = lastDataAt ? formatSessionTimestamp(lastDataAt, new Date(now)) : null
  const openedTime = lastOpenedAt ? formatSessionTimestamp(lastOpenedAt, new Date(now)) : null
  const archivedPreview = useSessionPreviewStore(s => s.previews[terminal.id])
  const archivedTimestamp = useSessionPreviewStore(s => s.timestamps[terminal.id])
  const preview = useClaudeStore(s => sessionPreviewText(s.sessions[terminal.id], archivedPreview, archivedTimestamp))
  const isWorker = isWorkerSession(terminal)
  const workerProcesses = useWorkerStore(s => s.panels[terminal.id]?.processes)

  // A plain shell has no agent turn to report, so its process really is the
  // whole story; only SDK sessions have live agent activity to consult.
  const live = { isStreaming, turnStartedAt, lastCompletedAt, meta: { runtimeStatus } }
  const activity: SessionActivity = isSdkAgentSession(terminal)
    ? deriveAgentActivity(live, now)
    : isWorker
      ? deriveWorkerActivity(workerProcesses)
      : derivePtyActivity(terminal)
  // A worker's story is its roster, not a pid: how many are up, and whether
  // any went down on their own.
  const workerCrashed = workerProcesses?.filter(p => p.status === 'crashed').length ?? 0
  const workerSummary = isWorker
    ? [
        procfileBasename(terminal.procfilePath ?? ''),
        workerProcesses
          ? t('worker.row.summary', {
              total: workerProcesses.length,
              running: workerProcesses.filter(p => p.status === 'running' || p.status === 'starting').length,
            })
          : null,
        workerCrashed > 0 ? t('worker.row.crashed', { count: workerCrashed }) : null,
      ].filter(Boolean).join(' · ')
    : null
  // The host's phase word ("queued", "compacting") beats a generic "Working"
  // when it has one — it's the difference between "busy" and "stuck on me".
  const phase = activity === 'working' && runtimePhaseLabel(live)

  return (
    <TouchableOpacity style={[styles.card, (activity === 'working' || activity === 'completed') && [styles.highlightedCard, { borderColor: ACTIVITY_COLOR[activity] }]]} onPress={() => onPress(terminal)} disabled={closing}>
      <View style={styles.statusRow}>
        <ActivityBadge activity={activity} />
        {phase ? <Text style={styles.phase}>{t(`claude.runtimeStatus.${runtimeStatus === 'starting' ? 'preparing' : runtimeStatus === 'waiting_for_api' ? 'waiting' : runtimeStatus}`)}</Text> : null}
        <View style={styles.times}>
          {isSdkAgentSession(terminal) && dataTime ? <Text style={styles.time} accessibilityLabel={`${t('session.recency.lastData')} ${dataTime.full}`}>{t('session.recency.updatedShort')} {dataTime.short}</Text> : null}
          {openedTime ? <Text style={styles.time} accessibilityLabel={`${t('session.recency.lastOpened')} ${openedTime.full}`}>{t('session.recency.openedShort')} {openedTime.short}</Text> : null}
        </View>
      </View>
      <View style={styles.row}>
        <Text style={[styles.icon, preset ? { color: preset.color } : isWorker ? { color: WORKER_ICON_COLOR } : null]}>
          {preset?.icon || (isWorker ? '\u2699' : '>')}
        </Text>
        <View style={styles.info}>
          {contextLabel ? (
            <Text style={styles.context} numberOfLines={1}>{contextLabel}</Text>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {terminal.alias || terminal.title}
          </Text>
          <Text style={styles.cwd} numberOfLines={1}>{terminal.cwd}</Text>
          {workerSummary ? <Text style={[styles.recency, workerCrashed > 0 && styles.recencyAlert]} numberOfLines={1}>{workerSummary}</Text> : null}
        </View>
        {closing ? (
          <ActivityIndicator size="small" color={appColors.accent} style={styles.trailing} />
        ) : (
          <TouchableOpacity style={styles.closeButton} onPress={() => onRequestClose(terminal)}>
            <Text style={styles.closeButtonText}>{t('terminalList.button.close')}</Text>
          </TouchableOpacity>
        )}
      </View>
      {isSdkAgentSession(terminal) && preview ? <Text style={styles.preview} numberOfLines={2}>{preview}</Text> : null}
      <WorktreeControls terminal={terminal} closing={closing} onCloseSession={onCloseSession} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  highlightedCard: { borderLeftWidth: 5 },
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
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: fontSize.sm * 1.5,
  },
  recency: { color: appColors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
  recencyAlert: { color: appColors.error },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  phase: {
    flexShrink: 1,
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
  },
  times: { marginLeft: 'auto', alignItems: 'flex-end', flexShrink: 0 },
  time: { color: appColors.textMuted, fontSize: fontSize.xs },
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
