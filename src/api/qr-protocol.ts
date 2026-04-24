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
  context?: {
    windowId?: string | null
  }
}

export function parseBATQR(raw: string): BATQRPayload | null {
  const urlPayload = parseConnectionUrlPayload(raw)
  if (urlPayload) return urlPayload

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
        context: parseContext(data.context),
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
        context: parseContext(data.context),
      }
    }
  } catch {
    // not valid JSON
  }
  return null
}

function parseConnectionUrlPayload(raw: string): BATQRPayload | null {
  const trimmed = raw.trim()
  if (!/^wss?:\/\//i.test(trimmed)) return null

  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname
    const port = parsed.port ? parseInt(parsed.port, 10) : 9876
    const token = parsed.searchParams.get('token') || ''
    const fingerprint = parsed.searchParams.get('fp') || parsed.searchParams.get('fingerprint')
    const mode = parsed.searchParams.get('mode') || 'url'
    const windowId = parsed.searchParams.get('windowId')

    if (!host || !token || !fingerprint || isNaN(port)) return null
    return {
      name: `${host}:${port}`,
      host,
      port,
      token,
      fingerprint,
      mode,
      useTLS: parsed.protocol === 'wss:',
      context: windowId ? { windowId } : undefined,
    }
  } catch {
    return null
  }
}

function parseWsUrl(url: string): { host: string; port: number; tls: boolean } | null {
  try {
    const parsed = new URL(url)
    const tls = parsed.protocol === 'wss:'
    const host = parsed.hostname
    const port = parsed.port ? parseInt(parsed.port, 10) : 9876
    if (!host || isNaN(port)) return null
    return { host, port, tls }
  } catch {
    return null
  }
}

function parseContext(value: unknown): BATQRPayload['context'] {
  if (!value || typeof value !== 'object') return undefined
  const windowId = (value as { windowId?: unknown }).windowId
  return typeof windowId === 'string' ? { windowId } : undefined
}
