import React, { useEffect, useRef, useState } from 'react'
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useClaudeStore } from '@/stores/claude-store'
import { useConnectionStore } from '@/stores/connection-store'
import type { SessionMeta } from '@/types'
import { appColors, fontSize, spacing } from '@/theme/colors'

function hasFastMode(
  value: unknown,
): value is SessionMeta & { fastMode: boolean; supportsFastMode: boolean } {
  const meta = value as SessionMeta | null
  return (
    !!meta &&
    typeof meta.fastMode === 'boolean' &&
    typeof meta.supportsFastMode === 'boolean'
  )
}

export function FastModeControl({
  sessionId,
  disabled = false,
}: {
  sessionId: string
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const channels = useConnectionStore(s => s.channels)
  const connected = useConnectionStore(s => s.status === 'connected')
  const scope = useClaudeStore(s => s.scopeKey)
  const meta = useClaudeStore(s => s.sessions[sessionId]?.meta)
  const streaming = useClaudeStore(
    s => s.sessions[sessionId]?.isStreaming ?? false,
  )
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const generation = useRef(0)
  const inFlight = useRef(false)

  const explainError = (cause: unknown) => {
    const message = String(cause)
    if (/BAT_DEBUG|host settings/i.test(message))
      return t('fastMode.hostPolicy')
    if (/does not support Fast/i.test(message)) return t('fastMode.unsupported')
    if (/current turn/i.test(message)) return t('fastMode.busy')
    if (/method not found|unknown method|unsupported.*channel/i.test(message))
      return t('fastMode.unavailable')
    return message
  }

  useEffect(() => {
    const lifecycle = generation
    ++lifecycle.current
    inFlight.current = false
    setPending(false)
    setOpen(false)
    setError('')
    setUnavailable(false)
    return () => {
      ++lifecycle.current
    }
  }, [channels, scope, sessionId])

  useEffect(() => {
    if (hasFastMode(meta)) setUnavailable(false)
  }, [meta])

  // A settings change on the host may revoke Fast without an immediate status
  // broadcast. Refresh when opening the control, without restarting the session.
  useEffect(() => {
    if (!open || !connected || !channels) {
      setFetching(false)
      return
    }
    let active = true
    const previous = useClaudeStore.getState().sessions[sessionId]?.meta
    setFetching(true)
    channels.claude
      .getSessionMeta(sessionId)
      .then(value => {
        if (
          !active ||
          useConnectionStore.getState().channels !== channels ||
          useClaudeStore.getState().scopeKey !== scope
        )
          return
        // A newer broadcast or reset supersedes the read.
        if (useClaudeStore.getState().sessions[sessionId]?.meta !== previous)
          return
        if (hasFastMode(value)) {
          setUnavailable(false)
          useClaudeStore.getState().handleStatus(sessionId, value)
        } else {
          if (value === null)
            useClaudeStore.getState().handleRuntimeMissing(sessionId)
          setUnavailable(true)
        }
      })
      .catch(() => {
        if (
          active &&
          useClaudeStore.getState().sessions[sessionId]?.meta === previous
        )
          setUnavailable(true)
      })
      .finally(() => {
        if (active) setFetching(false)
      })
    return () => {
      active = false
    }
  }, [open, channels, connected, scope, sessionId])

  const known = hasFastMode(meta)
  const busy =
    disabled || streaming || !!meta?.runtimeStatus || meta?.isStreaming === true
  const unsupported = known && !meta.supportsFastMode
  const state =
    !known || unavailable
      ? 'unknown'
      : !meta.fastMode
      ? 'off'
      : ['on', 'pending', 'cooldown'].includes(meta.fastModeState ?? '')
      ? meta.fastModeState!
      : 'requested'
  const blocked =
    !connected ||
    !known ||
    unavailable ||
    busy ||
    fetching ||
    pending ||
    (unsupported && !meta?.fastMode)
  const hint = !connected
    ? t('fastMode.offline')
    : unavailable || !known
    ? t('fastMode.unavailable')
    : busy
    ? t('fastMode.busy')
    : unsupported
    ? t('fastMode.unsupported')
    : t(`fastMode.${state}Hint`)

  const toggle = async (enabled: boolean) => {
    if (blocked || inFlight.current || !channels) return
    const started = generation.current
    const previous = useClaudeStore.getState().sessions[sessionId]?.meta
    const current = () =>
      generation.current === started &&
      useConnectionStore.getState().channels === channels &&
      useClaudeStore.getState().scopeKey === scope
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const value = await channels.claude.setFastMode(sessionId, enabled)
      if (!current()) return
      if (!hasFastMode(value)) throw new Error(t('fastMode.unavailable'))
      // Never optimistically enable Fast or overwrite a newer host broadcast.
      if (useClaudeStore.getState().sessions[sessionId]?.meta === previous) {
        useClaudeStore.getState().handleStatus(sessionId, value)
      }
    } catch (cause) {
      if (current()) setError(explainError(cause))
    } finally {
      if (current()) {
        inFlight.current = false
        setPending(false)
      }
    }
  }

  return (
    <>
      <TouchableOpacity
        testID="fast-mode-control"
        accessibilityRole="button"
        accessibilityLabel={`${t('fastMode.title')}: ${t(`fastMode.${state}`)}`}
        style={styles.chip}
        onPress={() => {
          setError('')
          setOpen(true)
        }}
      >
        <Text style={[styles.label, meta?.fastMode === true && styles.enabled]}>
          Fast · {t(`fastMode.${state}`)}
        </Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView>
              <Text style={styles.title}>{t('fastMode.title')}</Text>
              <View style={styles.row}>
                <Text style={styles.label}>{t('fastMode.enable')}</Text>
                <Switch
                  testID="fast-mode-switch"
                  accessibilityLabel={t('fastMode.enable')}
                  value={known && !unavailable && meta.fastMode}
                  disabled={blocked}
                  onValueChange={toggle}
                  trackColor={{
                    false: appColors.border,
                    true: appColors.accent,
                  }}
                />
              </View>
              <Text testID="fast-mode-state" style={styles.label}>
                {pending || fetching
                  ? t('fastMode.savingOrLoading')
                  : t(`fastMode.${state}`)}
              </Text>
              <Text style={styles.hint}>{hint}</Text>
              {!!meta?.fastModeDisabledReason && (
                <Text style={styles.hint}>{meta.fastModeDisabledReason}</Text>
              )}
              <Text style={styles.hint}>{t('fastMode.costHint')}</Text>
              {!!error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.close}
                onPress={() => setOpen(false)}
              >
                <Text style={styles.enabled}>{t('common.close')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: appColors.surface,
  },
  label: { color: appColors.text, fontSize: fontSize.sm },
  enabled: { color: appColors.accent },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  title: { color: appColors.text, fontSize: fontSize.lg, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  hint: {
    color: appColors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  error: {
    color: appColors.error,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  close: {
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
})
