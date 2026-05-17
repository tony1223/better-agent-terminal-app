import { Alert } from 'react-native'
import { parseBATQR } from '@/api/qr-protocol'
import { useConnectionStore } from '@/stores/connection-store'
import { useHostStore } from '@/stores/host-store'
import { dlog } from '@/utils/debug-log'

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

export async function openConnectionLink(rawUrl: string): Promise<boolean> {
  const payload = parseBATQR(rawUrl)
  if (!payload) return false

  const hostStore = useHostStore.getState()
  hostStore.loadFromStorage()
  const existing = hostStore.findByAddress(payload.host, payload.port)

  try {
    const { id } = await hostStore.upsertHost(
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
    hostStore.setActiveHost(id)

    dlog('DEEPLINK', `connecting to ${payload.host}:${payload.port} tls=${payload.useTLS}`)
    const ok = await useConnectionStore.getState().connect(
      payload.host,
      payload.port,
      payload.token,
      payload.fingerprint,
      payload.context,
      payload.useTLS,
    )
    if (!ok) {
      const err = useConnectionStore.getState().error
      const mismatch = parseFingerprintMismatch(err)
      if (mismatch) {
        Alert.alert(
          'Certificate Changed',
          `"${existing?.name ?? payload.name}" is presenting a new TLS certificate.\n\n` +
            `Link expected:\n${formatFingerprint(mismatch.expected)}\n\n` +
            `Server now:\n${formatFingerprint(mismatch.got)}\n\n` +
            `Only trust if you just reconfigured BAT Desktop.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Trust & Connect',
              style: 'destructive',
              onPress: async () => {
                await hostStore.updateFingerprint(id, mismatch.got)
                const retry = await useConnectionStore.getState().connect(
                  payload.host,
                  payload.port,
                  payload.token,
                  mismatch.got,
                  payload.context,
                  true,
                )
                if (!retry) {
                  const retryError = useConnectionStore.getState().error
                  Alert.alert('Connection Failed', retryError || 'Could not connect after trusting new fingerprint.')
                }
              },
            },
          ],
        )
      } else {
        Alert.alert('Connection Failed', err || 'Could not connect from BAT link. Host was saved.')
      }
    }
    return true
  } catch (e) {
    dlog('DEEPLINK', `open error: ${e}`)
    Alert.alert('BAT Link Failed', String(e))
    return true
  }
}
