/**
 * AddHostScreen - Add or edit a BAT host connection
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
import { appColors, spacing, fontSize } from '@/theme/colors'
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
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const isValid = name.trim() && address.trim() && port.trim() && token.trim()

  const handleTest = async () => {
    if (!isValid) return
    setTesting(true)

    const client = new WebSocketClient()
    const ok = await client.connect(address.trim(), parseInt(port, 10), token.trim(), 'BAT-Mobile-Test')
    client.disconnect()

    setTesting(false)
    Alert.alert(ok ? 'Success' : 'Failed', ok ? 'Connection successful!' : 'Could not connect. Check address, port, and token.')
  }

  const handleSave = async () => {
    if (!isValid) return
    setSaving(true)

    await addHost(
      {
        name: name.trim(),
        address: address.trim(),
        port: parseInt(port, 10),
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
  input: {
    backgroundColor: appColors.surface,
    borderRadius: 10,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: appColors.text,
    borderWidth: 1,
    borderColor: appColors.border,
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
