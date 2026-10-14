import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Channels } from '@/api/channels'
import { isRemoteMethodNotFound } from '@/api/websocket-client'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing } from '@/theme/colors'
import type { AccountProvider } from './HostAccountManager'
import { hostAccountTarget } from './host-account-target'

/** Credentials stay on the host. Never persist/log authorization URLs or codes. */
export function HostAccountLogin({ provider, channels, onSuccess }: {
  provider: AccountProvider; channels: Channels; onSuccess: () => void
}) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'starting' | 'waiting' | 'submitting' | 'error'>('starting')
  const [url, setUrl] = useState('')
  const [deviceCode, setDeviceCode] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const loginId = useRef('')
  const completed = useRef(false)
  const alive = useRef(false)
  const submitting = useRef(false)
  const [target] = useState(() => hostAccountTarget(channels))
  const connection = useConnectionStore()
  const ready = connection.status === 'connected' && !!target.channels()
  const success = useRef(onSuccess)
  success.current = onSuccess
  const current = () => alive.current && target.matches()
  const errorText = (err: unknown) => err instanceof Error && isRemoteMethodNotFound(err) ? t('accounts.unsupported')
    : String(err).includes('auth_in_progress') ? t('accounts.inProgress') : String(err || t('accounts.loginFailed'))

  useEffect(() => {
    alive.current = true
    let stopped = false
    let cancelled = false
    let polling = false
    let pollStopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let appState = AppState.currentState
    const owned = () => !stopped && target.matches()
    const cancel = () => {
      // A pending start can complete after close. Cancel only the login it created.
      if (!loginId.current || completed.current || cancelled) return
      cancelled = true
      const api = (target.channels() || channels).claude
      const call = provider === 'codex' ? api.codexAuthLoginCancel : api.authLoginCancel
      call(loginId.current).catch(() => {})
    }
    const fail = (err: unknown) => {
      if (!owned()) return
      pollStopped = true
      setError(errorText(err))
      setPhase('error')
    }
    const poll = async () => {
      if (!owned() || polling || pollStopped || !loginId.current || appState !== 'active') return
      const transport = target.channels()
      if (!transport) return
      polling = true
      try {
        const result = await transport.claude.codexAuthLoginPoll(loginId.current)
        if (!owned()) return
        if (result?.status === 'success') {
          completed.current = true
          pollStopped = true
          success.current()
          return
        }
        if (result?.status !== 'pending') { fail(result?.error || t('accounts.loginFailed')); return }
      } catch (err) { if (target.channels() === transport) fail(err) }
      finally {
        polling = false
        if (owned() && !pollStopped && appState === 'active') timer = setTimeout(poll, 2000)
      }
    }
    const subscription = AppState.addEventListener('change', state => {
      appState = state
      if (timer !== undefined) clearTimeout(timer)
      if (state === 'active' && provider === 'codex') poll()
    })
    const unsubscribe = useConnectionStore.subscribe((state, previous) => {
      if (provider === 'codex' && (state.channels !== previous.channels || state.status !== previous.status || state.profileStatus !== previous.profileStatus)) {
        if (timer !== undefined) clearTimeout(timer)
        poll()
      }
    })
    const start = async () => {
      try {
        const result = provider === 'codex' ? await channels.claude.codexAuthLoginStart() : await channels.claude.authLoginStart()
        if (result?.ok && result.loginId) loginId.current = result.loginId
        if (!owned()) { cancel(); return }
        if (!result?.ok || !result.loginId || !result.url || (provider === 'codex' && !result.code)) {
          fail(result?.error || t('accounts.loginFailed')); return
        }
        // Only a browser URL is valid; never execute custom schemes returned by a host.
        if (!/^https:\/\/[^/\s]+(?:\/|$)/i.test(result.url)) { fail(t('accounts.invalidUrl')); return }
        setUrl(result.url)
        setDeviceCode(result.code || '')
        setPhase('waiting')
        if (provider === 'codex') poll()
      } catch (err) { fail(err) }
    }
    start()
    return () => {
      stopped = true
      alive.current = false
      if (timer !== undefined) clearTimeout(timer)
      subscription.remove()
      unsubscribe()
      cancel()
    }
    // A login belongs to one mounted flow, never restart it on a translation/render change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, provider, target])

  const submit = async () => {
    const transport = target.channels()
    if (submitting.current || phase !== 'waiting' || !code.trim() || !current() || !transport) return
    submitting.current = true
    setPhase('submitting')
    setError('')
    try {
      const result = await transport.claude.authLoginSubmitCode(code.trim(), loginId.current)
      if (!current()) return
      if (result?.success === true) {
        completed.current = true
        setCode('')
        success.current()
      } else {
        setError(errorText(result?.error))
        setPhase(result?.terminal ? 'error' : 'waiting')
      }
    } catch (err) {
      if (current()) { setError(errorText(err)); setPhase('error') }
    } finally { submitting.current = false }
  }
  const openBrowser = async () => {
    try { await Linking.openURL(url) }
    catch { if (current()) setError(t('accounts.openFailed')) }
  }

  return <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
    {!ready && <Text style={styles.error}>{t('accounts.offline')}</Text>}
    {(phase === 'starting' || phase === 'submitting') && <ActivityIndicator />}
    <Text style={styles.text}>{t(phase === 'starting' ? 'accounts.starting' : provider === 'codex' ? 'accounts.codexSteps' : 'accounts.claudeSteps')}</Text>
    {!!deviceCode && <Text testID="login-device-code" selectable style={styles.code}>{deviceCode}</Text>}
    {!!url && <>
      <TouchableOpacity testID="login-open-browser" accessibilityRole="button" onPress={openBrowser} style={styles.button}>
        <Text style={styles.action}>{t('accounts.openBrowser')}</Text>
      </TouchableOpacity>
      <Text selectable style={styles.url}>{url}</Text>
    </>}
    {provider === 'claude' && (phase === 'waiting' || phase === 'submitting') && <>
      <TextInput testID="login-code-input" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false}
        secureTextEntry editable={phase === 'waiting'} placeholder={t('accounts.codePlaceholder')}
        accessibilityLabel={t('accounts.codePlaceholder')} placeholderTextColor={appColors.textSecondary} style={styles.input} />
      <TouchableOpacity testID="login-submit" accessibilityRole="button" disabled={!ready || phase !== 'waiting' || !code.trim()} onPress={submit} style={styles.button}>
        <Text style={styles.action}>{t('accounts.submit')}</Text>
      </TouchableOpacity>
    </>}
    {provider === 'codex' && phase === 'waiting' && <Text style={styles.text}>{t('accounts.waiting')}</Text>}
    {!!error && <Text accessibilityLiveRegion="polite" selectable style={styles.error}>{error}</Text>}
    {phase === 'error' && <Text style={styles.text}>{t('accounts.retryLogin')}</Text>}
  </ScrollView>
}
const styles = StyleSheet.create({
  body: { flexGrow: 0 },
  text: { color: appColors.textSecondary, marginVertical: spacing.sm },
  code: { color: appColors.text, fontSize: 28, textAlign: 'center', marginVertical: spacing.md },
  url: { color: appColors.textSecondary, fontSize: 12 },
  button: { minHeight: 44, padding: spacing.md, alignItems: 'center' },
  action: { color: appColors.accent, fontSize: 16 },
  error: { color: appColors.error, marginVertical: spacing.sm },
  input: { color: appColors.text, backgroundColor: appColors.background, borderRadius: 8, padding: spacing.md, marginTop: spacing.md },
})
