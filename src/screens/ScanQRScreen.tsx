/**
 * ScanQRScreen - Scan BAT QR code to add host
 * Supports new QR format with TLS fingerprint.
 */

import React, { useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Linking,
} from 'react-native'
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { parseBATQR, type BATQRPayload } from '@/api/qr-protocol'
import { useHostStore } from '@/stores/host-store'
import { useConnectionStore } from '@/stores/connection-store'
import { appColors, spacing, fontSize } from '@/theme/colors'
import { dlog } from '@/utils/debug-log'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'

type Props = NativeStackScreenProps<any, 'ScanQR'>

export function ScanQRScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets()
  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')
  const [scanned, setScanned] = useState(false)
  const scannedRef = useRef(false)

  const { addHost, setActiveHost } = useHostStore()
  const { connect } = useConnectionStore()

  const handlePayload = useCallback(async (payload: BATQRPayload) => {
    dlog('QR', `parsed OK: ${payload.host}:${payload.port} tls=${payload.useTLS} fp=${payload.fingerprint ? payload.fingerprint.slice(0, 12) + '...' : 'none'} mode=${payload.mode}`)

    const tlsLabel = payload.useTLS ? ' (TLS)' : ''
    Alert.alert(
      'BAT Host Found',
      `Connect to "${payload.name}"${tlsLabel}\n${payload.host}:${payload.port}?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            dlog('QR', 'user cancelled')
            scannedRef.current = false
            setScanned(false)
          },
        },
        {
          text: 'Save Only',
          onPress: async () => {
            try {
              dlog('QR', 'saving host...')
              await addHost(
                {
                  name: payload.name,
                  address: payload.host,
                  port: payload.port,
                  fingerprint: payload.fingerprint ?? undefined,
                  useTLS: payload.useTLS,
                },
                payload.token,
              )
              dlog('QR', 'saved OK')
              navigation.goBack()
            } catch (e) {
              dlog('QR', `save error: ${e}`)
            }
          },
        },
        {
          text: 'Connect',
          style: 'default',
          onPress: async () => {
            try {
              dlog('QR', 'saving host before connect...')
              await addHost(
                {
                  name: payload.name,
                  address: payload.host,
                  port: payload.port,
                  fingerprint: payload.fingerprint ?? undefined,
                  useTLS: payload.useTLS,
                },
                payload.token,
              )
              const hosts = useHostStore.getState().hosts
              const newHost = hosts[hosts.length - 1]
              if (newHost) {
                setActiveHost(newHost.id)
              }
              dlog('QR', `connecting to ${payload.host}:${payload.port} (tls=${payload.useTLS})...`)
              const ok = await connect(payload.host, payload.port, payload.token, payload.fingerprint)
              dlog('QR', `connect result: ${ok}`)
              if (ok) {
                navigation.goBack()
              } else {
                const err = useConnectionStore.getState().error
                dlog('QR', `connect failed: ${err}`)
                Alert.alert('Connection Failed', err || 'Could not connect. Host saved for later.')
                navigation.goBack()
              }
            } catch (e) {
              dlog('QR', `connect error: ${e}`)
            }
          },
        },
      ]
    )
  }, [addHost, connect, navigation, setActiveHost])

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (scannedRef.current) return
      const qrValue = codes[0]?.value
      if (!qrValue) return

      dlog('QR', `scanned raw: ${qrValue}`)

      const payload = parseBATQR(qrValue)
      if (!payload) {
        dlog('QR', 'parse failed - not BAT QR format')
        return
      }

      scannedRef.current = true
      setScanned(true)
      handlePayload(payload)
    },
  })

  // Permission not granted yet
  if (!hasPermission) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.message}>Camera permission is required to scan QR codes.</Text>
        <TouchableOpacity
          style={styles.permButton}
          onPress={async () => {
            const granted = await requestPermission()
            if (!granted) {
              Linking.openSettings()
            }
          }}
        >
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // No camera device
  if (!device) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.message}>No camera device found.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!scanned}
        codeScanner={codeScanner}
      />

      {/* Overlay */}
      <View style={[styles.overlay, { paddingTop: insets.top + 60 }]}>
        <Text style={styles.hint}>Scan BAT QR Code</Text>
        <View style={styles.viewfinder} />
        <Text style={styles.subHint}>
          BAT Desktop {'\u2192'} Settings {'\u2192'} Remote {'\u2192'} Show QR Code
        </Text>
      </View>
    </View>
  )
}

const VIEWFINDER_SIZE = 250

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  message: {
    fontSize: fontSize.lg,
    color: appColors.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  permButton: {
    backgroundColor: appColors.accent,
    borderRadius: 10,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  permButtonText: {
    fontSize: fontSize.md,
    color: '#fff',
    fontWeight: '700',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  hint: {
    fontSize: fontSize.xl,
    color: '#fff',
    fontWeight: '700',
    marginBottom: spacing.xxl,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderWidth: 2,
    borderColor: appColors.accent,
    borderRadius: 16,
  },
  subHint: {
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
})
