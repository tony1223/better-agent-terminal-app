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
    if (typeof data !== 'object' || data === null) return null

    return parseObjectPayload(data) ?? null
  } catch {
    // not valid JSON
  }
  return null
}

function parseObjectPayload(data: unknown): BATQRPayload | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  const wrapped =
    parseObjectPayload(obj.connection) ??
    parseObjectPayload(obj.payload) ??
    parseObjectPayload(obj.remote) ??
    parseObjectPayload(obj.data)
  if (wrapped) return wrapped

  const token = getString(obj.token) ?? getString(obj.authToken) ?? getString(obj.remoteToken)
  const fingerprint = getString(obj.fingerprint) ?? getString(obj.fp) ?? getString(obj.remoteFingerprint) ?? null
  const mode = getString(obj.mode) ?? 'unknown'

  // BAT Desktop format: { url: "wss://host:port", token, fingerprint, mode }
  const url = getString(obj.url) ?? getString(obj.wsUrl) ?? getString(obj.connectionUrl)
  if (url) {
    const urlPayload = parseConnectionUrlPayload(url)
    if (urlPayload) {
      return {
        ...urlPayload,
        name: getString(obj.name) ?? urlPayload.name,
        token: token ?? urlPayload.token,
        fingerprint: fingerprint ?? urlPayload.fingerprint,
        mode: getString(obj.mode) ?? urlPayload.mode,
        context: parseContext(obj.context) ?? urlPayload.context,
      }
    }

    const parsed = parseWsUrl(url)
    if (parsed && token) {
      return {
        name: getString(obj.name) ?? `BAT (${mode})`,
        host: parsed.host,
        port: parsed.port,
        token,
        fingerprint,
        mode,
        useTLS: parsed.tls,
        context: parseContext(obj.context),
      }
    }
  }

  // Direct format: { host, port, token, fingerprint }
  const host = getString(obj.host) ?? getString(obj.address) ?? getString(obj.remoteHost)
  const port = getNumber(obj.port) ?? getNumber(obj.remotePort)
  if (host && port && token) {
    return {
      name: getString(obj.name) ?? `${host}:${port}`,
      host,
      port,
      token,
      fingerprint,
      mode,
      useTLS: !!fingerprint,
      context: parseContext(obj.context),
    }
  }

  return null
}

function parseConnectionUrlPayload(raw: string): BATQRPayload | null {
  const trimmed = raw.trim()
  if (!/^(wss?|bat|batmobile|better-terminal):/i.test(trimmed)) return null

  try {
    const parsed = new URL(trimmed)
    const isWs = /^wss?:$/i.test(parsed.protocol)
    const host = isWs
      ? parsed.hostname
      : parsed.searchParams.get('host') || parsed.searchParams.get('address') || ''
    const port = isWs
      ? (parsed.port ? parseInt(parsed.port, 10) : 9876)
      : parseInt(parsed.searchParams.get('port') || '9876', 10)
    const token = parsed.searchParams.get('token') || ''
    const fingerprint = parsed.searchParams.get('fp') || parsed.searchParams.get('fingerprint') || null
    const mode = parsed.searchParams.get('mode') || 'url'
    const windowId = parsed.searchParams.get('windowId')

    if (!host || !token || isNaN(port)) return null
    return {
      name: `${host}:${port}`,
      host,
      port,
      token,
      fingerprint,
      mode,
      useTLS: parsed.protocol === 'wss:' || !!fingerprint,
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

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function parseContext(value: unknown): BATQRPayload['context'] {
  if (!value || typeof value !== 'object') return undefined
  const windowId = (value as { windowId?: unknown }).windowId
  return typeof windowId === 'string' ? { windowId } : undefined
}
