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

  const parsed = parseUrlParts(trimmed)
  if (!parsed) return null

  const isWs = parsed.protocol === 'ws' || parsed.protocol === 'wss'
  const host = isWs
    ? parsed.host
    : parsed.params.host || parsed.params.address || ''
  const port = isWs
    ? parsed.port ?? 9876
    : getNumber(parsed.params.port) ?? 9876
  const token = parsed.params.token || ''
  const fingerprint = parsed.params.fp || parsed.params.fingerprint || null
  const mode = parsed.params.mode || 'url'
  const windowId = parsed.params.windowId

  if (!host || !token || !Number.isFinite(port)) return null
  return {
    name: `${host}:${port}`,
    host,
    port,
    token,
    fingerprint,
    mode,
    useTLS: parsed.protocol === 'wss' || !!fingerprint,
    context: windowId ? { windowId } : undefined,
  }
}

function parseWsUrl(url: string): { host: string; port: number; tls: boolean } | null {
  const parsed = parseUrlParts(url)
  if (!parsed || (parsed.protocol !== 'ws' && parsed.protocol !== 'wss')) return null
  const port = parsed.port ?? 9876
  if (!parsed.host || !Number.isFinite(port)) return null
  return { host: parsed.host, port, tls: parsed.protocol === 'wss' }
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

function parseUrlParts(url: string): {
  protocol: string
  host: string
  port?: number
  params: Record<string, string>
} | null {
  const match = url.trim().match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(?:[^?#]*)?(?:\?([^#]*))?/i)
  if (!match) return null

  const protocol = match[1].toLowerCase()
  const authority = match[2]
  const query = match[3] ?? ''
  const hostPort = parseHostPort(authority)
  if (!hostPort) return null

  return {
    protocol,
    host: hostPort.host,
    port: hostPort.port,
    params: parseQuery(query),
  }
}

function parseHostPort(authority: string): { host: string; port?: number } | null {
  if (!authority) return { host: '' }
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end === -1) return null
    const host = authority.slice(1, end)
    const rest = authority.slice(end + 1)
    const port = rest.startsWith(':') ? getNumber(rest.slice(1)) : undefined
    return { host, port }
  }

  const colon = authority.lastIndexOf(':')
  if (colon > -1) {
    const host = authority.slice(0, colon)
    const port = getNumber(authority.slice(colon + 1))
    return { host, port }
  }
  return { host: authority }
}

function parseQuery(query: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of query.split('&')) {
    if (!part) continue
    const equal = part.indexOf('=')
    const rawKey = equal === -1 ? part : part.slice(0, equal)
    const rawValue = equal === -1 ? '' : part.slice(equal + 1)
    const key = decodeQueryPart(rawKey)
    if (!key) continue
    result[key] = decodeQueryPart(rawValue)
  }
  return result
}

function decodeQueryPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function parseContext(value: unknown): BATQRPayload['context'] {
  if (!value || typeof value !== 'object') return undefined
  const windowId = (value as { windowId?: unknown }).windowId
  return typeof windowId === 'string' ? { windowId } : undefined
}
