/**
 * QR Code connection protocol
 *
 * BAT Desktop generates a QR code containing JSON:
 * { "url": "wss://192.168.1.100:9876", "token": "xxx", "fingerprint": "AB:CD:...", "mode": "lan"|"tailscale"|... }
 *
 * We parse the url to extract host and port.
 */

export interface BATQRPayload {
  name: string
  host: string
  port: number
  token: string
  fingerprint: string | null
  mode: string
  useTLS: boolean
}

export function parseBATQR(raw: string): BATQRPayload | null {
  try {
    const data = JSON.parse(raw)
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof data.token !== 'string'
    ) {
      return null
    }

    // BAT Desktop format: { url: "wss://host:port", token, fingerprint, mode }
    if (typeof data.url === 'string' && data.url.match(/^wss?:/)) {
      const parsed = parseWsUrl(data.url)
      if (!parsed) return null
      return {
        name: data.name || `BAT (${data.mode || 'remote'})`,
        host: parsed.host,
        port: parsed.port,
        token: data.token,
        fingerprint: data.fingerprint || null,
        mode: data.mode || 'unknown',
        useTLS: parsed.tls,
      }
    }

    // Direct format: { host, port, token, fingerprint }
    if (
      typeof data.host === 'string' &&
      typeof data.port === 'number'
    ) {
      return {
        name: data.name || `${data.host}:${data.port}`,
        host: data.host,
        port: data.port,
        token: data.token,
        fingerprint: data.fingerprint || null,
        mode: data.mode || 'unknown',
        useTLS: !!data.fingerprint,
      }
    }
  } catch {
    // not valid JSON
  }
  return null
}

function parseWsUrl(url: string): { host: string; port: number; tls: boolean } | null {
  try {
    const tls = url.startsWith('wss://')
    const stripped = url.replace(/^wss?:\/\//, '')
    const parts = stripped.split(':')
    if (parts.length < 2) return null
    const host = parts[0]
    const port = parseInt(parts[1], 10)
    if (!host || isNaN(port)) return null
    return { host, port, tls }
  } catch {
    return null
  }
}
