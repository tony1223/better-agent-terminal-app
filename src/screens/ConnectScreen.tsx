/**
 * ConnectScreen - Host selection and connection
 * Shows TLS security status for each host.
 */

import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Modal,
  TextInput,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useConnectionStore } from '@/stores/connection-store'
import { useHostStore } from '@/stores/host-store'
import { APP_VERSION } from '@/app-version'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { SavedHost } from '@/types'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

const FINGERPRINT_MISMATCH_RE = /TLS fingerprint mismatch\.\s*Expected:\s*([0-9A-F:]+),\s*Got:\s*([0-9A-F:]+)/i

function parseFingerprintMismatch(message: string | null): { expected: string; got: string } | null {
  if (!message) return null
  const match = message.match(FINGERPRINT_MISMATCH_RE)
  if (!match) return null
  return { expected: match[1], got: match[2] }
}

function formatFingerprint(fp: string): string {
  const clean = fp.toUpperCase().replace(/[^A-F0-9]/g, '')
  return clean.match(/.{1,2}/g)?.join(':') ?? clean
}

export function ConnectScreen({ navigation }: Props) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { hosts, loadFromStorage, removeHost, updateHost, getToken, getFingerprint, updateFingerprint, setActiveHost } = useHostStore()
  const { error, connect } = useConnectionStore()
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null)
  const [renamingHost, setRenamingHost] = useState<SavedHost | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    loadFromStorage()
  }, [loadFromStorage])

  const performConnect = async (host: SavedHost, fingerprintOverride?: string | null): Promise<boolean> => {
    const token = await getToken(host.id)
    if (!token) {
      Alert.alert(t('common.error'), t('connect.noToken'))
      return false
    }
    const fingerprint = fingerprintOverride !== undefined ? fingerprintOverride : getFingerprint(host.id)
    return connect(host.address, host.port, token, fingerprint, host.context, host.useTLS || !!fingerprint)
  }

  const handleConnect = async (host: SavedHost) => {
    setConnectingHostId(host.id)
    const ok = await performConnect(host)
    setConnectingHostId(null)

    if (ok) {
      setActiveHost(host.id)
      return
    }

    const latestError = useConnectionStore.getState().error || error
    const mismatch = parseFingerprintMismatch(latestError)
    if (mismatch) {
      Alert.alert(
        t('connect.certChangedTitle'),
        t('connect.certChangedMessage', {
          name: host.name,
          saved: formatFingerprint(mismatch.expected),
          server: formatFingerprint(mismatch.got),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('connect.trustConnect'),
            style: 'destructive',
            onPress: async () => {
              await updateFingerprint(host.id, mismatch.got)
              setConnectingHostId(host.id)
              const retry = await performConnect({ ...host, fingerprint: mismatch.got.replace(/:/g, '') })
              setConnectingHostId(null)
              if (retry) {
                setActiveHost(host.id)
              } else {
                const err = useConnectionStore.getState().error
                Alert.alert(t('common.connectionFailed'), err || t('connect.trustFailedMessage'))
              }
            },
          },
        ],
      )
    } else {
      Alert.alert(t('common.connectionFailed'), latestError || t('connect.connectFailedMessage'))
    }
  }

  const openRename = (host: SavedHost) => {
    setRenamingHost(host)
    setRenameValue(host.name)
  }

  const saveRename = async () => {
    if (!renamingHost) return
    const name = renameValue.trim()
    if (!name) {
      Alert.alert(t('connect.nameRequiredTitle'), t('connect.nameRequiredMessage'))
      return
    }
    await updateHost(renamingHost.id, { name })
    setRenamingHost(null)
    setRenameValue('')
  }

  const handleDelete = (host: SavedHost) => {
    Alert.alert(
      t('connect.deleteTitle'),
      t('connect.deleteMessage', { name: host.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => removeHost(host.id) },
      ]
    )
  }

  const handleHostActions = (host: SavedHost) => {
    Alert.alert(
      host.name,
      `${host.address}:${host.port}`,
      [
        { text: t('connect.rename'), onPress: () => openRename(host) },
        { text: t('common.delete'), style: 'destructive', onPress: () => handleDelete(host) },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    )
  }

  const renderHost = ({ item }: { item: SavedHost }) => {
    const isConnecting = connectingHostId === item.id
    const hasTLS = item.useTLS || !!item.fingerprint
    return (
      <View
        style={styles.hostCard}
      >
        <TouchableOpacity
          style={styles.hostPressArea}
          onPress={() => handleConnect(item)}
          onLongPress={() => handleHostActions(item)}
          disabled={isConnecting}
        >
          <View style={styles.hostNameRow}>
            <Text style={styles.hostName}>{item.name}</Text>
            {hasTLS && (
              <View style={styles.tlsBadge}>
                <Text style={styles.tlsBadgeText}>TLS</Text>
              </View>
            )}
          </View>
          <Text style={styles.hostAddress}>
            {hasTLS ? 'wss' : 'ws'}://{item.address}:{item.port}
          </Text>
          {hasTLS && item.fingerprint && (
            <Text style={styles.fingerprint}>
              {item.fingerprint.match(/.{1,2}/g)?.join(':').slice(0, 23)}...
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.hostMenuButton}
          onPress={() => handleHostActions(item)}
          disabled={isConnecting}
        >
          <Text style={styles.hostMenuButtonText}>...</Text>
        </TouchableOpacity>
        {isConnecting ? (
          <ActivityIndicator color={appColors.accent} />
        ) : (
          <View style={[styles.statusDot, { backgroundColor: hasTLS ? '#22c55e' : appColors.textMuted }]} />
        )}
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('LocalSettings')}
        >
          <Text style={styles.settingsButtonText}>{'\u2699'}</Text>
        </TouchableOpacity>
        <Text style={styles.logo}>BAT</Text>
        <Text style={styles.title}>Better Agent Terminal</Text>
        <Text style={styles.subtitle}>{t('connect.subtitle')}</Text>
      </View>

      <FlatList
        data={hosts}
        keyExtractor={(item) => item.id}
        renderItem={renderHost}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>{t('connect.emptyHosts')}</Text>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => navigation.navigate('ScanQR')}
        >
          <Text style={styles.scanButtonText}>{t('connect.scanQR')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('AddHost')}
        >
          <Text style={styles.addButtonText}>{t('connect.addHostManual')}</Text>
        </TouchableOpacity>
        <Text style={styles.version}>{t('connect.version', { version: APP_VERSION })}</Text>
      </View>

      <Modal
        visible={!!renamingHost}
        transparent
        animationType="fade"
        onRequestClose={() => setRenamingHost(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.renameDialog}>
            <Text style={styles.renameTitle}>{t('connect.renameTitle')}</Text>
            <TextInput
              style={styles.renameInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholder={t('connect.renamePlaceholder')}
              placeholderTextColor={appColors.textMuted}
              returnKeyType="done"
              onSubmitEditing={saveRename}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity
                style={styles.renameSecondaryButton}
                onPress={() => setRenamingHost(null)}
              >
                <Text style={styles.renameSecondaryText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.renamePrimaryButton} onPress={saveRename}>
                <Text style={styles.renamePrimaryText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  settingsButton: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsButtonText: {
    color: appColors.textSecondary,
    fontSize: 26,
  },
  logo: {
    fontSize: 48,
    fontWeight: '800',
    color: appColors.accent,
    letterSpacing: 4,
  },
  title: {
    fontSize: fontSize.lg,
    color: appColors.text,
    marginTop: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    marginTop: spacing.xs,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  hostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  hostPressArea: {
    flex: 1,
    minWidth: 0,
  },
  hostNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hostName: {
    fontSize: fontSize.lg,
    color: appColors.text,
    fontWeight: '600',
  },
  tlsBadge: {
    backgroundColor: '#16a34a22',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tlsBadgeText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  hostAddress: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  fingerprint: {
    fontSize: 10,
    color: appColors.textMuted,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  hostMenuButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.sm,
    backgroundColor: appColors.surfaceHover,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  hostMenuButtonText: {
    color: appColors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '800',
    lineHeight: fontSize.md,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: appColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  scanButton: {
    backgroundColor: appColors.accent,
    borderRadius: 12,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  scanButtonText: {
    fontSize: fontSize.lg,
    color: '#ffffff',
    fontWeight: '700',
  },
  addButton: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: appColors.border,
  },
  addButtonText: {
    fontSize: fontSize.md,
    color: appColors.text,
    fontWeight: '600',
  },
  version: {
    fontSize: fontSize.sm,
    color: appColors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  renameDialog: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  renameTitle: {
    color: appColors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  renameInput: {
    color: appColors.text,
    backgroundColor: appColors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  renameSecondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: appColors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: appColors.surfaceHover,
  },
  renameSecondaryText: {
    color: appColors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  renamePrimaryButton: {
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: appColors.accent,
  },
  renamePrimaryText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
})
