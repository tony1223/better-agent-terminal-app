import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Channels } from '@/api/channels'
import { isRemoteMethodNotFound } from '@/api/websocket-client'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing } from '@/theme/colors'
import { HostAccountLogin } from './HostAccountLogin'
import { hostAccountTarget } from './host-account-target'

export type AccountProvider = 'codex' | 'claude'
interface Account { id: string; label: string; detail?: string; active: boolean; needsLogin: boolean }

/** Mounted only while open. Every request belongs to this captured profile transport. */
export function HostAccountManager({ provider, channels, onClose }: {
  provider: AccountProvider; channels: Channels; onClose: () => void
}) {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [login, setLogin] = useState<Channels | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const alive = useRef(true)
  const busy = useRef(false)
  const [target] = useState(() => hostAccountTarget(channels))
  const connection = useConnectionStore()
  const providerName = provider === 'codex' ? 'Codex' : 'Claude'
  const ready = !!target.channels()
  const current = useCallback(() => alive.current && target.matches(), [target])
  const errorText = useCallback((value: unknown) => value instanceof Error && isRemoteMethodNotFound(value)
    ? t('accounts.unsupported')
    : String(value).includes('auth_in_progress') ? t('accounts.inProgress') : String(value), [t])

  const refresh = useCallback(async () => {
    const transport = target.channels()
    if (!transport) return
    setLoading(true)
    setError('')
    try {
      let entries: Account[]
      if (provider === 'codex') {
        const result = await transport.claude.codexAccountList()
        if (!Array.isArray(result?.accounts)) throw new Error(t('accounts.loadFailed'))
        const explicitActive = result.accounts.some(account => account.active === true)
        entries = result.accounts.map(account => ({
          id: account.id, label: account.email || account.label || account.id,
          detail: account.email && account.label !== account.email ? account.label : undefined,
          // Unified accounts share CODEX_HOME; only their per-account flag identifies the active login.
          active: account.active === true || (!explicitActive && account.active === undefined && !account.unified &&
            !!account.codexHome && account.codexHome === result.activeCodexHome),
          needsLogin: account.needsLogin === true || account.authenticated === false,
        }))
      } else {
        const result = await transport.claude.accountList()
        if (!Array.isArray(result?.accounts)) throw new Error(t('accounts.loadFailed'))
        entries = result.accounts.map(account => ({ id: account.id, label: account.email || account.id,
          detail: account.subscriptionType, active: account.id === result.activeAccountId, needsLogin: false }))
      }
      if (current() && target.channels() === transport) setAccounts(entries)
    } catch (err) {
      if (current()) setError(errorText(err))
    } finally {
      if (current()) setLoading(false)
    }
  }, [target, provider, current, errorText, t])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => { if (ready && !login) refresh() }, [ready, connection.channels, login, refresh])
  useEffect(() => { if (!target.matches()) onClose() }, [connection, target, onClose])

  const select = async (account: Account) => {
    const transport = target.channels()
    if (busy.current || !transport || account.active || account.needsLogin) return
    busy.current = true
    setSwitching(account.id)
    setError('')
    setNotice('')
    try {
      const result = provider === 'codex'
        ? await transport.claude.codexAccountSwitch(account.id)
        : await transport.claude.accountSwitch(account.id)
      if (!current()) return
      const ok = provider === 'claude' ? result === true : typeof result === 'object' && result?.success === true
      if (!ok) throw new Error(t('accounts.switchFailed'))
      setNotice(t('accounts.switched'))
      await refresh()
    } catch (err) {
      if (current()) setError(errorText(err))
    } finally {
      busy.current = false
      if (current()) setSwitching(null)
    }
  }
  const loginSucceeded = useCallback(() => {
    if (!current()) return
    setLogin(null)
    setNotice(t('accounts.loginSucceeded'))
  }, [current, t])

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.panel}>
        <Text style={styles.title}>{t('accounts.title', { provider: providerName })}</Text>
        <Text style={styles.hint}>{t('accounts.host', { host: connection.selectedProfileName || connection.host || 'BAT' })}</Text>
        {login ? <HostAccountLogin provider={provider} channels={login} onSuccess={loginSucceeded} /> : <>
          <Text style={styles.hint}>{t('accounts.scopeHint')}</Text>
          {!ready && <Text style={styles.error}>{t('accounts.offline')}</Text>}
          {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
          {!!error && <Text accessibilityLiveRegion="polite" selectable style={styles.error}>{error}</Text>}
          {loading ? <ActivityIndicator /> : <ScrollView style={styles.list}>
            {!accounts.length && !error && <Text style={styles.hint}>{t('accounts.empty')}</Text>}
            {accounts.map(account => <TouchableOpacity key={account.id} testID={`account-${account.id}`}
              accessibilityRole="button" accessibilityState={{ selected: account.active, disabled: !ready || !!switching || account.active || account.needsLogin }}
              disabled={!ready || !!switching || account.active || account.needsLogin} onPress={() => select(account)}
              style={[styles.row, account.active && styles.active]}>
              <View style={styles.label}>
                <Text style={styles.text}>{account.label}</Text>
                {!!account.detail && <Text style={styles.hint}>{account.detail}</Text>}
                {account.needsLogin && <Text style={styles.error}>{t('accounts.needsLogin')}</Text>}
              </View>
              {switching === account.id ? <ActivityIndicator /> : account.active && <Text style={styles.notice}>{t('accounts.active')}</Text>}
            </TouchableOpacity>)}
          </ScrollView>}
          <TouchableOpacity testID="account-login" accessibilityRole="button" style={styles.button}
            disabled={!ready || !!switching || loading} onPress={() => { setError(''); setLogin(target.channels()) }}>
            <Text style={styles.action}>{t('accounts.add')}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="accounts-refresh" accessibilityRole="button" style={styles.button}
            disabled={!ready || !!switching || loading} onPress={refresh}>
            <Text style={styles.text}>{t('accounts.refresh')}</Text>
          </TouchableOpacity>
        </>}
        <TouchableOpacity testID="accounts-close" accessibilityRole="button" style={styles.button} onPress={onClose}>
          <Text style={styles.text}>{t(login ? 'common.cancel' : 'common.close')}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: spacing.xl },
  panel: { backgroundColor: appColors.surface, borderRadius: 16, padding: spacing.lg, maxHeight: '85%' },
  title: { color: appColors.text, fontSize: 20, fontWeight: 'bold', marginBottom: spacing.sm },
  hint: { color: appColors.textSecondary, fontSize: 14, marginBottom: spacing.sm },
  text: { color: appColors.text, fontSize: 16 },
  action: { color: appColors.accent, fontSize: 16, fontWeight: 'bold' },
  error: { color: appColors.error, marginVertical: spacing.sm },
  notice: { color: appColors.success, marginVertical: spacing.sm },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 8, marginBottom: spacing.sm },
  active: { backgroundColor: appColors.surfaceHover },
  label: { flex: 1, marginRight: spacing.sm },
  button: { alignItems: 'center', padding: spacing.md, minHeight: 44 },
})
