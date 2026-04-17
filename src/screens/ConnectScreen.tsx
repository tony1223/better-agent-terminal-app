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
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useConnectionStore } from '@/stores/connection-store'
import { useHostStore } from '@/stores/host-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import type { SavedHost } from '@/types'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

export function ConnectScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets()
  const { hosts, loadFromStorage, removeHost, getToken, getFingerprint, setActiveHost } = useHostStore()
  const { status, error, connect } = useConnectionStore()
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null)

  useEffect(() => {
    loadFromStorage()
  }, [])

  const handleConnect = async (host: SavedHost) => {
    setConnectingHostId(host.id)
    const token = await getToken(host.id)
    if (!token) {
      Alert.alert('Error', 'No token found for this host')
      setConnectingHostId(null)
      return
    }

    const fingerprint = getFingerprint(host.id)
    const ok = await connect(host.address, host.port, token, fingerprint)
    setConnectingHostId(null)

    if (ok) {
      setActiveHost(host.id)
    } else {
      Alert.alert('Connection Failed', error || 'Could not connect to host')
    }
  }

  const handleDelete = (host: SavedHost) => {
    Alert.alert(
      'Delete Host',
      `Remove "${host.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeHost(host.id) },
      ]
    )
  }

  const renderHost = ({ item }: { item: SavedHost }) => {
    const isConnecting = connectingHostId === item.id
    const hasTLS = !!item.fingerprint
    return (
      <TouchableOpacity
        style={styles.hostCard}
        onPress={() => handleConnect(item)}
        onLongPress={() => handleDelete(item)}
        disabled={isConnecting}
      >
        <View style={styles.hostInfo}>
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
        </View>
        {isConnecting ? (
          <ActivityIndicator color={appColors.accent} />
        ) : (
          <View style={[styles.statusDot, { backgroundColor: hasTLS ? '#22c55e' : appColors.textMuted }]} />
        )}
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.logo}>BAT</Text>
        <Text style={styles.title}>Better Agent Terminal</Text>
        <Text style={styles.subtitle}>Mobile Remote Client</Text>
      </View>

      <FlatList
        data={hosts}
        keyExtractor={(item) => item.id}
        renderItem={renderHost}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No saved hosts. Add one to get started.</Text>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => navigation.navigate('ScanQR')}
        >
          <Text style={styles.scanButtonText}>Scan QR Code</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('AddHost')}
        >
          <Text style={styles.addButtonText}>+ Add Host Manually</Text>
        </TouchableOpacity>
      </View>
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
  hostInfo: {
    flex: 1,
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
})
