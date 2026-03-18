/**
 * QR Code connection protocol
 *
 * BAT Desktop generates a QR code containing JSON:
 * { "url": "ws://192.168.1.100:9876", "token": "xxx", "mode": "lan"|"tailscale"|... }
 *
 * We parse the url to extract host and port.
 */

export interface BATQRPayload {
  name: string
  host: string
  port: number
  token: string
  mode: string
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

    // BAT Desktop format: { url: "ws://host:port", token, mode }
    if (typeof data.url === 'string' && data.url.startsWith('ws')) {
      const parsed = parseWsUrl(data.url)
      if (!parsed) return null
      return {
        name: `BAT (${data.mode || 'remote'})`,
        host: parsed.host,
        port: parsed.port,
        token: data.token,
        mode: data.mode || 'unknown',
      }
    }

    // Future-proof: { bat: 1, host, port, token } format
    if (
      typeof data.host === 'string' &&
      typeof data.port === 'number'
    ) {
      return {
        name: data.name || `${data.host}:${data.port}`,
        host: data.host,
        port: data.port,
        token: data.token,
        mode: data.mode || 'unknown',
      }
    }
  } catch {
    // not valid JSON
  }
  return null
}

function parseWsUrl(url: string): { host: string; port: number } | null {
  try {
    // ws://host:port or wss://host:port
    const stripped = url.replace(/^wss?:\/\//, '')
    const parts = stripped.split(':')
    if (parts.length < 2) return null
    const host = parts[0]
    const port = parseInt(parts[1], 10)
    if (!host || isNaN(port)) return null
    return { host, port }
  } catch {
    return null
  }
}
