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
  ActivityIndicator,
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
  const [scanStatus, setScanStatus] = useState('Point the camera at the BAT Desktop QR code.')
  const scannedRef = useRef(false)

  const { upsertHost, findByAddress, setActiveHost } = useHostStore()
  const { connect } = useConnectionStore()
  const connectionStatus = useConnectionStore(s => s.status)
  const connectionError = useConnectionStore(s => s.error)
  const [connecting, setConnecting] = useState<{ host: string; port: number } | null>(null)

  const closeScanner = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack()
      return
    }

    const target = useConnectionStore.getState().status === 'connected' ? 'Main' : 'Connect'
    navigation.reset({
      index: 0,
      routes: [{ name: target }],
    })
  }, [navigation])

  const handlePayload = useCallback(async (payload: BATQRPayload) => {
    dlog('QR', `parsed OK: ${payload.host}:${payload.port} tls=${payload.useTLS} fp=${payload.fingerprint ? payload.fingerprint.slice(0, 12) + '...' : 'none'} mode=${payload.mode}`)
    setScanStatus(`Found ${payload.host}:${payload.port}.`)

    const existing = findByAddress(payload.host, payload.port)
    const tlsLabel = payload.useTLS ? ' (TLS)' : ''
    const title = existing ? 'Update BAT Host' : 'BAT Host Found'
    const fingerprintChanged =
      existing && payload.fingerprint &&
      existing.fingerprint?.toUpperCase().replace(/:/g, '') !==
        payload.fingerprint.toUpperCase().replace(/:/g, '')
    const message = existing
      ? `Refresh "${existing.name}"${tlsLabel}\n${payload.host}:${payload.port}` +
        (fingerprintChanged ? '\n\nFingerprint changed — will overwrite the saved one.' : '')
      : `Connect to "${payload.name}"${tlsLabel}\n${payload.host}:${payload.port}?`

    const doSave = async (): Promise<{ id: string; created: boolean }> => {
      const result = await upsertHost(
        {
          name: existing?.name ?? payload.name,
          address: payload.host,
          port: payload.port,
          fingerprint: payload.fingerprint ?? undefined,
          useTLS: payload.useTLS,
          context: payload.context,
        },
        payload.token,
      )
      dlog('QR', `${result.created ? 'created' : 'updated'} host ${result.id}`)
      return result
    }

    Alert.alert(title, message, [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => {
          dlog('QR', 'user cancelled')
          scannedRef.current = false
          setScanned(false)
          setScanStatus('Point the camera at the BAT Desktop QR code.')
        },
      },
      {
        text: existing ? 'Update Only' : 'Save Only',
        onPress: async () => {
          try {
            await doSave()
            closeScanner()
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
            const { id } = await doSave()
            setActiveHost(id)
            setConnecting({ host: payload.host, port: payload.port })
            dlog('QR', `connecting to ${payload.host}:${payload.port} (tls=${payload.useTLS})...`)
            const ok = await connect(payload.host, payload.port, payload.token, payload.fingerprint, payload.context)
            dlog('QR', `connect result: ${ok}`)
            if (ok) {
              setConnecting(null)
              closeScanner()
            } else {
              const err = useConnectionStore.getState().error
              dlog('QR', `connect failed: ${err}`)
              setConnecting(null)
              scannedRef.current = false
              setScanned(false)
              setScanStatus('Connection failed — try again or scan a new QR code.')
              Alert.alert('Connection Failed', err || 'Could not connect. Host saved for later.')
            }
          } catch (e) {
            dlog('QR', `connect error: ${e}`)
            setConnecting(null)
          }
        },
      },
    ])
  }, [upsertHost, findByAddress, connect, closeScanner, setActiveHost])

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (scannedRef.current) return
      const qrValue = codes.find(code => code.value)?.value
      if (!qrValue) {
        if (codes.length > 0) {
          setScanStatus('QR detected, but it could not be decoded.')
          console.log(`[BAT][QR] detected ${codes.length} code(s) without value`)
        }
        return
      }

      setScanStatus('QR detected. Reading connection details...')
      console.log(`[BAT][QR] scanned value length=${qrValue.length}`)

      const payload = parseBATQR(qrValue)
      if (!payload) {
        setScanStatus('QR detected, but it is not a BAT connection code.')
        console.log('[BAT][QR] parse failed - not BAT QR format')
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
        onInitialized={() => {
          setScanStatus('Camera ready. Point at the desktop QR code.')
          console.log('[BAT][QR] camera initialized')
        }}
        onError={(error) => {
          const message = `Camera error: ${error.code}`
          setScanStatus(message)
          console.warn(`[BAT][QR] ${message}`, error)
        }}
      />

      {/* Overlay */}
      <View style={[styles.overlay, { paddingTop: insets.top + 60 }]}>
        <Text style={styles.hint}>Scan BAT QR Code</Text>
        <View style={styles.viewfinder} />
        <Text style={styles.subHint}>
          BAT Desktop {'\u2192'} Settings {'\u2192'} Remote {'\u2192'} Show QR Code
        </Text>
        <Text style={styles.status}>{scanStatus}</Text>
      </View>

      {connecting && (
        <View style={styles.connectingOverlay}>
          <View style={styles.connectingCard}>
            <ActivityIndicator color={appColors.accent} size="large" />
            <Text style={styles.connectingTitle}>Connecting\u2026</Text>
            <Text style={styles.connectingHost}>
              {connecting.host}:{connecting.port}
            </Text>
            <Text style={styles.connectingState}>
              Status: {connectionStatus}
            </Text>
            {connectionError && (
              <Text style={styles.connectingError}>{connectionError}</Text>
            )}
            <Text style={styles.connectingHint}>
              Auth times out after 10 seconds.
            </Text>
          </View>
        </View>
      )}
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
  connectingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  connectingCard: {
    backgroundColor: appColors.surface,
    borderRadius: 12,
    padding: spacing.xxl,
    alignItems: 'center',
    minWidth: 260,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  connectingTitle: {
    fontSize: fontSize.lg,
    color: appColors.text,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  connectingHost: {
    fontSize: fontSize.sm,
    color: appColors.textSecondary,
    fontFamily: 'monospace',
    marginTop: spacing.xs,
  },
  connectingState: {
    fontSize: fontSize.sm,
    color: appColors.accent,
    marginTop: spacing.md,
    fontWeight: '600',
  },
  connectingError: {
    fontSize: fontSize.xs,
    color: '#ef4444',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  connectingHint: {
    fontSize: fontSize.xs,
    color: appColors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  status: {
    fontSize: fontSize.sm,
    color: '#fff',
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    overflow: 'hidden',
  },
})
