import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { appColors, fontSize, spacing } from '@/theme/colors'
import type { TerminalInstance } from '@/types'

type WorktreeMergedKind = NonNullable<TerminalInstance['worktreeMergedKind']>
type WorktreeStrategy = 'merge' | 'cherry-pick'

const VALID_MERGED_KINDS = new Set<WorktreeMergedKind>([
  'ancestor',
  'patch-equivalent',
  'ahead',
  'diverged',
  'unknown',
])

const STATUS_TONES: Record<WorktreeMergedKind, { color: string; labelKey: string }> = {
  ancestor: { color: appColors.success, labelKey: 'worktree.status.merged' },
  'patch-equivalent': { color: appColors.success, labelKey: 'worktree.status.merged' },
  ahead: { color: appColors.warning, labelKey: 'worktree.status.ahead' },
  diverged: { color: appColors.error, labelKey: 'worktree.status.diverged' },
  unknown: { color: appColors.textMuted, labelKey: 'worktree.status.unknown' },
}

interface Props {
  terminal: TerminalInstance
  closing?: boolean
  onCloseSession: (terminal: TerminalInstance, options?: { cleanWorktree?: boolean }) => Promise<void>
}

export function WorktreeControls({ terminal, closing, onCloseSession }: Props) {
  const { t } = useTranslation()
  const channels = useConnectionStore(s => s.channels)
  const connectionStatus = useConnectionStore(s => s.status)
  const [visible, setVisible] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [statusKind, setStatusKind] = useState<WorktreeMergedKind | null>(
    normalizeMergedKind(terminal.worktreeMergedKind),
  )

  const branch = terminal.worktreeBranch || terminal.branchName || t('worktree.branchFallback')
  const status = statusKind ? STATUS_TONES[statusKind] : null

  const refreshStatus = useCallback(async (showError = true) => {
    if (!channels || !terminal.worktreePath) return
    setBusyAction('status')
    try {
      const result = await channels.worktree.status(terminal.id)
      const kind = normalizeMergedKind((result as { mergedKind?: unknown } | null)?.mergedKind)
      setStatusKind(kind ?? 'unknown')
    } catch (e) {
      if (showError) Alert.alert(t('worktree.alerts.statusFailed'), String(e))
    } finally {
      setBusyAction(null)
    }
  }, [channels, terminal.id, terminal.worktreePath, t])

  useEffect(() => {
    setStatusKind(normalizeMergedKind(terminal.worktreeMergedKind))
  }, [terminal.worktreeMergedKind])

  useEffect(() => {
    if (connectionStatus === 'connected' && terminal.worktreePath) {
      refreshStatus(false).catch(() => undefined)
    }
  }, [connectionStatus, refreshStatus, terminal.worktreePath])

  const merge = useCallback((strategy: WorktreeStrategy) => {
    if (!channels) return
    const title = strategy === 'merge'
      ? t('worktree.alerts.mergeTitle')
      : t('worktree.alerts.cherryPickTitle')
    const message = strategy === 'merge'
      ? t('worktree.alerts.mergeMessage', { branch })
      : t('worktree.alerts.cherryPickMessage', { branch })
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: strategy === 'merge' ? t('worktree.actions.merge') : t('worktree.actions.cherryPick'),
        onPress: async () => {
          setVisible(false)
          setBusyAction(strategy)
          try {
            const result = await channels.worktree.merge(terminal.id, strategy)
            const normalized = normalizeMutationResult(result)
            if (!normalized.success) {
              throw new Error(normalized.error || t('worktree.alerts.mergeFailed'))
            }
            const kind = normalizeMergedKind(normalized.mergedKind)
            if (kind) setStatusKind(kind)
            await useWorkspaceStore.getState().load()
            await refreshStatus(false)
            Alert.alert(t('worktree.alerts.mergeDone'), normalized.message || '')
          } catch (e) {
            Alert.alert(t('worktree.alerts.mergeFailed'), String(e))
          } finally {
            setBusyAction(null)
          }
        },
      },
    ])
  }, [branch, channels, refreshStatus, t, terminal.id])

  const closeWithCleanup = useCallback(() => {
    Alert.alert(
      t('worktree.alerts.closeCleanupTitle'),
      t('worktree.alerts.closeCleanupMessage', { branch }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('worktree.actions.closeCleanup'),
          style: 'destructive',
          onPress: async () => {
            setVisible(false)
            setBusyAction('close-cleanup')
            try {
              await onCloseSession(terminal, { cleanWorktree: true })
            } catch (e) {
              Alert.alert(t('worktree.alerts.closeCleanupFailed'), String(e))
            } finally {
              setBusyAction(null)
            }
          },
        },
      ],
    )
  }, [branch, onCloseSession, t, terminal])

  const closeOnly = useCallback(() => {
    Alert.alert(
      t('worktree.alerts.closeTitle'),
      t('worktree.alerts.closeMessage', { branch }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('worktree.actions.closeKeep'),
          style: 'destructive',
          onPress: async () => {
            setVisible(false)
            setBusyAction('close')
            try {
              await onCloseSession(terminal, { cleanWorktree: false })
            } catch (e) {
              Alert.alert(t('worktree.alerts.closeFailed'), String(e))
            } finally {
              setBusyAction(null)
            }
          },
        },
      ],
    )
  }, [branch, onCloseSession, t, terminal])

  const actions = useMemo(() => [
    { key: 'status', label: t('worktree.actions.refreshStatus'), onPress: () => refreshStatus(true) },
    { key: 'merge', label: t('worktree.actions.merge'), onPress: () => merge('merge') },
    { key: 'cherry-pick', label: t('worktree.actions.cherryPick'), onPress: () => merge('cherry-pick') },
    { key: 'close', label: t('worktree.actions.closeKeep'), onPress: closeOnly, destructive: true },
    { key: 'close-cleanup', label: t('worktree.actions.closeCleanup'), onPress: closeWithCleanup, destructive: true },
  ], [closeOnly, closeWithCleanup, merge, refreshStatus, t])

  if (!terminal.worktreePath) return null

  return (
    <View style={styles.root}>
      <View style={styles.metaRow}>
        <Text style={styles.branchText} numberOfLines={1}>
          {t('worktree.label')} · {branch}
        </Text>
        {status && statusKind !== 'unknown' ? (
          <Text style={[styles.statusChip, { color: status.color, borderColor: status.color }]}>
            {t(status.labelKey)}
          </Text>
        ) : null}
      </View>
      <View style={styles.pathRow}>
        <Text style={styles.pathText} numberOfLines={1}>{terminal.worktreePath}</Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setVisible(true)}
          disabled={closing || !!busyAction}
        >
          {busyAction ? (
            <ActivityIndicator size="small" color={appColors.accent} />
          ) : (
            <Text style={styles.actionButtonText}>{t('worktree.actions.title')}</Text>
          )}
        </TouchableOpacity>
      </View>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('worktree.title')}</Text>
            <Text style={styles.sheetSubtitle} numberOfLines={2}>{branch}</Text>
            {actions.map(action => (
              <TouchableOpacity
                key={action.key}
                style={styles.sheetButton}
                onPress={action.onPress}
                disabled={!!busyAction}
              >
                <Text style={[styles.sheetButtonText, action.destructive && styles.destructiveText]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelButton} onPress={() => setVisible(false)}>
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function normalizeMergedKind(value: unknown): WorktreeMergedKind | null {
  return typeof value === 'string' && VALID_MERGED_KINDS.has(value as WorktreeMergedKind)
    ? value as WorktreeMergedKind
    : null
}

function normalizeMutationResult(value: unknown): {
  success: boolean
  error?: string
  message?: string
  mergedKind?: unknown
} {
  if (value === true) return { success: true }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false }
  }
  const record = value as Record<string, unknown>
  return {
    success: record.success === true,
    error: typeof record.error === 'string' ? record.error : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    mergedKind: record.mergedKind,
  }
}

const styles = StyleSheet.create({
  root: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: appColors.border,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  branchText: {
    flex: 1,
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    fontSize: fontSize.xs,
    fontWeight: '800',
  },
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  pathText: {
    flex: 1,
    color: appColors.textMuted,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  actionButton: {
    minWidth: 78,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.background,
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  actionButtonText: {
    color: appColors.accent,
    fontSize: fontSize.xs,
    fontWeight: '800',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    backgroundColor: appColors.surface,
    padding: spacing.lg,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderTopWidth: 1,
    borderColor: appColors.border,
  },
  sheetTitle: {
    color: appColors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  sheetSubtitle: {
    color: appColors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  sheetButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: appColors.border,
  },
  sheetButtonText: {
    color: appColors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  destructiveText: {
    color: appColors.error,
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    borderRadius: 6,
    backgroundColor: appColors.surfaceHover,
  },
  cancelButtonText: {
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
})
