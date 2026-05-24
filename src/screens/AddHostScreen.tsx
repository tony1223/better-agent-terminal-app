/**
 * AddHostScreen - Add or edit a BAT host connection
 * Supports TLS with certificate fingerprint pinning.
 */

import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useHostStore } from '@/stores/host-store'
import { WebSocketClient } from '@/api/websocket-client'
import { parseBATQR, type BATQRPayload } from '@/api/qr-protocol'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { dlog } from '@/utils/debug-log'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

type Props = {
  navigation: NativeStackNavigationProp<any>
}

export function AddHostScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets()
  const { addHost } = useHostStore()

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('9876')
  const [token, setToken] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [connectionString, setConnectionString] = useState('')
  const [useTLS, setUseTLS] = useState(false)
  const [context, setContext] = useState<BATQRPayload['context']>(undefined)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const isValid = name.trim() && address.trim() && port.trim() && token.trim()
  const hasFingerprint = fingerprint.trim().length > 0
  const hasTLS = useTLS || hasFingerprint

  const normalizeFingerprint = (fp: string): string => {
    return fp.trim().toUpperCase().replace(/[^A-F0-9]/g, '')
  }

  const formatFingerprint = (fp: string): string => {
    const clean = normalizeFingerprint(fp)
    return clean.match(/.{1,2}/g)?.join(':') ?? clean
  }

  const applyPayload = (payload: BATQRPayload) => {
    setName(payload.name)
    setAddress(payload.host)
    setPort(String(payload.port))
    setToken(payload.token)
    setFingerprint(payload.fingerprint ? formatFingerprint(payload.fingerprint) : '')
    setUseTLS(payload.useTLS)
    setContext(payload.context)
  }

  const handleConnectionStringChange = (value: string) => {
    setConnectionString(value)
    const payload = parseBATQR(value)
    if (payload) applyPayload(payload)
  }

  const handleApplyConnectionString = () => {
    const payload = parseBATQR(connectionString)
    if (!payload) {
      Alert.alert('Invalid Connection String', 'Paste a BAT link, ws/wss URL, or BAT Desktop QR JSON payload.')
      return
    }
    applyPayload(payload)
  }

  const handleTest = async () => {
    if (!isValid) return
    dlog('!CONN_TEST', 'test pressed', {
      address: address.trim(),
      port: parseInt(port, 10),
      hasTLS,
      hasFingerprint,
      hasContext: !!context,
    })
    setTesting(true)

    try {
      const client = new WebSocketClient()
      const fp = hasFingerprint ? normalizeFingerprint(fingerprint) : null
      const ok = await client.connect(
        address.trim(),
        parseInt(port, 10),
        token.trim(),
        'BAT-Mobile-Test',
        fp,
        context,
        hasTLS,
      )
      const err = client.error
      client.disconnect()

      if (ok) {
        Alert.alert('Success', `Connection successful!${hasTLS ? ' (TLS)' : ''}`)
      } else {
        const message = err || 'Could not connect. Check address, port, token, and fingerprint.'
        dlog('!CONN_TEST', message, {
          address: address.trim(),
          port: parseInt(port, 10),
          hasTLS,
          hasFingerprint,
          hasContext: !!context,
        })
        Alert.alert('Failed', message)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!isValid) return
    setSaving(true)

    const fp = hasFingerprint ? normalizeFingerprint(fingerprint) : undefined

    await addHost(
      {
        name: name.trim(),
        address: address.trim(),
        port: parseInt(port, 10),
        fingerprint: fp,
        useTLS: hasTLS,
        context,
      },
      token.trim()
    )

    setSaving(false)
    navigation.goBack()
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.label}>Connection String</Text>
        <TextInput
          style={[styles.input, styles.connectionInput]}
          value={connectionString}
          onChangeText={handleConnectionStringChange}
          placeholder="Paste BAT link, ws/wss URL, or QR JSON"
          placeholderTextColor={appColors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <TouchableOpacity
          style={[styles.applyButton, !connectionString.trim() && styles.buttonDisabled]}
          onPress={handleApplyConnectionString}
          disabled={!connectionString.trim()}
        >
          <Text style={styles.applyButtonText}>Apply Connection String</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g., Work MacBook"
          placeholderTextColor={appColors.textMuted}
          autoFocus
        />

        <Text style={styles.label}>Address</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="e.g., 192.168.1.100 or hostname"
          placeholderTextColor={appColors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.label}>Port</Text>
        <TextInput
          style={styles.input}
          value={port}
          onChangeText={setPort}
          placeholder="9876"
          placeholderTextColor={appColors.textMuted}
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="32-character hex token"
          placeholderTextColor={appColors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>
          TLS Fingerprint{' '}
          <Text style={styles.labelOptional}>(from BAT Desktop Settings)</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.fingerprintInput]}
          value={fingerprint}
          onChangeText={(value) => {
            setFingerprint(value)
            if (value.trim()) {
              setUseTLS(true)
            }
          }}
          onBlur={() => { if (fingerprint) setFingerprint(formatFingerprint(fingerprint)) }}
          placeholder="AB:CD:EF:... (SHA-256)"
          placeholderTextColor={appColors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          multiline
        />
        {hasTLS && (
          <View style={styles.tlsBadge}>
            <Text style={styles.tlsBadgeText}>
              {hasFingerprint ? 'TLS Pinning Enabled' : 'TLS Enabled'}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.testButton, !isValid && styles.buttonDisabled]}
          onPress={handleTest}
          disabled={!isValid || testing}
        >
          {testing ? (
            <ActivityIndicator color={appColors.text} />
          ) : (
            <Text style={styles.testButtonText}>Test Connection</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveButton, !isValid && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={!isValid || saving}
        >
          {saving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appColors.background,
  },
  scroll: {
    padding: spacing.lg,
  },
  label: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  labelOptional: {
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: fontSize.xs,
    color: appColors.textMuted,
  },
  input: {
    backgroundColor: appColors.surface,
    borderRadius: 10,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: appColors.text,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  connectionInput: {
    minHeight: 86,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fontSize.sm,
  },
  applyButton: {
    backgroundColor: appColors.surfaceHover,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  applyButtonText: {
    fontSize: fontSize.sm,
    color: appColors.text,
    fontWeight: '700',
  },
  fingerprintInput: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: fontSize.sm,
    minHeight: 60,
  },
  tlsBadge: {
    marginTop: spacing.sm,
    backgroundColor: '#16a34a22',
    borderRadius: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  tlsBadgeText: {
    color: '#22c55e',
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  testButton: {
    backgroundColor: appColors.surface,
    borderRadius: 10,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xxl,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  testButtonText: {
    fontSize: fontSize.md,
    color: appColors.text,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: appColors.accent,
    borderRadius: 10,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveButtonText: {
    fontSize: fontSize.lg,
    color: '#ffffff',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
})
