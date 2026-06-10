/**
 * WebSocket Client for BAT Remote Protocol
 * Reference: BAT Desktop electron/remote/remote-client.ts
 *
 * Supports wss:// with SHA-256 certificate fingerprint pinning via native TLS module.
 * Falls back to plain ws:// when TLS is not requested.
 * Implements auth, request-response correlation, event dispatch, and exponential backoff reconnect.
 */

import {
  PROXIED_EVENTS,
  REMOTE_COMPRESSION_GZIP,
  REMOTE_COMPRESSION_NONE,
  REMOTE_PROTOCOL_LEGACY_V1,
  REMOTE_PROTOCOL_V2,
  type RemoteFrame,
} from './protocol'
import { TLSWebSocket } from '@/native/tls-websocket'
import { dlog } from '@/utils/debug-log'

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error'

interface PendingInvoke {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingPing {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type EventHandler = (...args: unknown[]) => void
type StatusListener = (status: ConnectionStatus) => void
type RemoteProtocol = typeof REMOTE_PROTOCOL_V2 | typeof REMOTE_PROTOCOL_LEGACY_V1
type RemoteCompression = typeof REMOTE_COMPRESSION_GZIP | typeof REMOTE_COMPRESSION_NONE

export interface RemoteClientContext {
  windowId?: string | null
  clientInfo?: object | null
}

const AUTH_TIMEOUT_MS = 10_000
const INVOKE_TIMEOUT_MS = 30_000
const HEARTBEAT_MS = 30_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function canonicalRemoteChannel(channel: string): string {
  const rest = channel.startsWith('claude:') ? channel.slice('claude:'.length) : null
  if (!rest || rest === 'list-presets') return channel
  return `agent:${rest}`
}

function legacyRemoteChannel(channel: string): string {
  if (channel === 'agent:list-presets' || channel === 'agent:get-supported-session-types') {
    return channel
  }
  return channel.startsWith('agent:')
    ? `claude:${channel.slice('agent:'.length)}`
    : channel
}

function valueAt(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : null
}

function summarizeRemoteValue(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`
  const record = asRecord(value)
  if (!record) return value == null ? String(value) : typeof value
  const parts = Object.keys(record).slice(0, 8).map(key => {
    const field = record[key]
    return Array.isArray(field) ? `${key}:array(${field.length})` : `${key}:${field == null ? String(field) : typeof field}`
  })
  return `{${parts.join(',')}}`
}

function isRemoteMethodNotFound(error: Error): boolean {
  return /method not found/i.test(error.message)
}

function eventParamsToArgs(channel: string, params: unknown): unknown[] {
  if (Array.isArray(params)) return params
  const record = asRecord(params)
  if (!record) return params === undefined ? [] : [params]

  switch (canonicalRemoteChannel(channel)) {
    case 'pty:output':
      return [valueAt(record, 'id'), valueAt(record, 'data')]
    case 'pty:exit':
      return [valueAt(record, 'id'), valueAt(record, 'exitCode')]
    case 'pty:viewport-state':
      return [valueAt(record, 'id'), valueAt(record, 'state')]
    case 'agent:session-reset':
      return [valueAt(record, 'sessionId')]
    case 'agent:message':
      return [valueAt(record, 'sessionId'), valueAt(record, 'message')]
    case 'agent:tool-use':
      return [valueAt(record, 'sessionId'), valueAt(record, 'toolCall')]
    case 'agent:tool-result':
      return [valueAt(record, 'sessionId'), valueAt(record, 'result')]
    case 'agent:stream':
      return [valueAt(record, 'sessionId'), valueAt(record, 'data')]
    case 'agent:result':
      return [valueAt(record, 'sessionId'), valueAt(record, 'result')]
    case 'agent:turn-end':
      return [valueAt(record, 'sessionId'), valueAt(record, 'payload')]
    case 'agent:error':
      return [valueAt(record, 'sessionId'), valueAt(record, 'error')]
    case 'agent:status':
      return [valueAt(record, 'sessionId'), valueAt(record, 'meta')]
    case 'agent:modeChange':
      return [valueAt(record, 'sessionId'), valueAt(record, 'mode')]
    case 'agent:history':
      return [valueAt(record, 'sessionId'), record.items ?? record.payload ?? null]
    case 'agent:resume-loading':
      return [valueAt(record, 'sessionId'), record.loading ?? record.payload ?? null]
    case 'agent:permission-request':
    case 'agent:ask-user':
      return [valueAt(record, 'sessionId'), valueAt(record, 'data')]
    case 'agent:permission-resolved':
    case 'agent:ask-user-resolved':
      return [valueAt(record, 'sessionId'), valueAt(record, 'toolUseId')]
    case 'agent:prompt-suggestion':
      return [valueAt(record, 'sessionId'), valueAt(record, 'suggestion')]
    case 'agent:worktree-info':
      return [valueAt(record, 'sessionId'), valueAt(record, 'payload')]
    case 'agent:rate-limit':
      return [valueAt(record, 'sessionId'), valueAt(record, 'info')]
    default:
      return [params]
  }
}

export class WebSocketClient {
  private ws: TLSWebSocket | null = null
  private pending: Map<string, PendingInvoke> = new Map()
  private pendingPings: Map<string, PendingPing> = new Map()
  private listeners: Map<string, Set<EventHandler>> = new Map()
  private statusListeners: Set<StatusListener> = new Set()
  private _status: ConnectionStatus = 'disconnected'
  private _counter = 0
  private _error: string | null = null
  private protocol: RemoteProtocol = REMOTE_PROTOCOL_LEGACY_V1

  // Connection params
  private host = ''
  private port = 0
  private token = ''
  private fingerprint: string | null = null
  private useTLS = false
  private label = ''
  private context: RemoteClientContext | null = null
  private shouldReconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private generation = 0
  private compression: RemoteCompression = REMOTE_COMPRESSION_NONE

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  get status(): ConnectionStatus {
    return this._status
  }

  get error(): string | null {
    return this._error
  }

  get isConnected(): boolean {
    return this._status === 'connected' && this.ws?.isOpen === true
  }

  get connectionInfo(): { host: string; port: number; tls: boolean; compression: RemoteCompression } | null {
    if (!this.isConnected) return null
    return { host: this.host, port: this.port, tls: this.useTLS, compression: this.compression }
  }

  get clientContext(): RemoteClientContext | null {
    return this.context
  }

  // ============================================
  //   Status Management
  // ============================================

  private setStatus(status: ConnectionStatus, error?: string) {
    this._status = status
    this._error = error ?? null
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  // ============================================
  //   Connect / Disconnect
  // ============================================

  connect(
    host: string,
    port: number,
    token: string,
    label?: string,
    fingerprint?: string | null,
    context?: RemoteClientContext | null,
    useTLS?: boolean,
  ): Promise<boolean> {
    if (this.ws) this.disconnect()

    this.host = host
    this.port = port
    this.token = token
    this.fingerprint = fingerprint ?? null
    this.useTLS = useTLS ?? !!this.fingerprint
    this.label = label || `BAT-Mobile-${Date.now()}`
    this.context = context ?? null
    this.shouldReconnect = true
    this.reconnectAttempt = 0
    this.protocol = REMOTE_PROTOCOL_LEGACY_V1
    this.compression = REMOTE_COMPRESSION_NONE
    this.generation++

    return this.doConnect()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Disconnected'))
    }
    this.pending.clear()

    this.rejectPendingPings(new Error('Disconnected'))

    if (this.ws) {
      this.ws.close(1000, 'client disconnect')
      this.ws = null
    }

    this.setStatus('disconnected')
  }

  // ============================================
  //   Internal Connect
  // ============================================

  private doConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      const gen = this.generation
      this.setStatus('connecting')

      const scheme = this.useTLS ? 'wss' : 'ws'
      const url = `${scheme}://${this.host}:${this.port}`
      dlog('WS', `connecting to ${url} (TLS=${this.useTLS}, pin=${!!this.fingerprint})`)

      const ws = new TLSWebSocket()
      this.ws = ws

      let authResolved = false

      const authTimeout = setTimeout(() => {
        if (!authResolved && gen === this.generation) {
          authResolved = true
          dlog('!WS', `auth timeout waiting for server response`, { host: this.host, port: this.port, tls: this.useTLS })
          this.setStatus('error', 'Authentication timeout')
          ws.close()
          resolve(false)
        }
      }, AUTH_TIMEOUT_MS)

      ws.connect(url, this.fingerprint, {
        onOpen: () => {
          if (gen !== this.generation) return
          dlog('WS', 'socket opened, sending auth...')
          this.setStatus('authenticating')
          const authFrame: RemoteFrame = {
            type: 'auth',
            id: this.nextId(),
            token: this.token,
            protocols: [REMOTE_PROTOCOL_V2, REMOTE_PROTOCOL_LEGACY_V1],
            compression: ws.supportsGzip ? [REMOTE_COMPRESSION_GZIP] : [],
            args: this.context ? [this.label, this.context] : [this.label],
          }
          ws.send(JSON.stringify(authFrame))
        },

        onMessage: (data: string) => {
          if (gen !== this.generation) return
          let frame: RemoteFrame
          try {
            frame = JSON.parse(data)
          } catch {
            return
          }

          if (frame.type === 'auth-result') {
            clearTimeout(authTimeout)
            if (!authResolved) {
              authResolved = true
              if (frame.error) {
                dlog('!WS', `auth failed: ${frame.error}`)
                this.setStatus('error', frame.error)
                resolve(false)
              } else {
                this.protocol = frame.protocol === REMOTE_PROTOCOL_V2
                  ? REMOTE_PROTOCOL_V2
                  : REMOTE_PROTOCOL_LEGACY_V1
                this.compression = frame.compression === REMOTE_COMPRESSION_GZIP
                  ? REMOTE_COMPRESSION_GZIP
                  : REMOTE_COMPRESSION_NONE
                dlog('WS', `auth success, connected! protocol=${this.protocol} compression=${this.compression}`)
                this.setStatus('connected')
                this.reconnectAttempt = 0
                this.startHeartbeat()
                resolve(true)
              }
            }
            return
          }

          if (frame.type === 'invoke-result' || frame.type === 'invoke-error') {
            const pending = this.pending.get(frame.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pending.delete(frame.id)
              if (frame.type === 'invoke-error') {
                pending.reject(new Error(frame.error || 'Remote invoke failed'))
              } else {
                pending.resolve(frame.result)
              }
            }
            return
          }

          if (frame.type === 'pong') {
            const pendingPing = this.pendingPings.get(frame.id)
            if (pendingPing) {
              clearTimeout(pendingPing.timer)
              this.pendingPings.delete(frame.id)
              pendingPing.resolve()
            }
            return
          }

          if (frame.type === 'event' && frame.channel) {
            const channel = canonicalRemoteChannel(frame.channel)
            if (!PROXIED_EVENTS.has(frame.channel) && !PROXIED_EVENTS.has(channel)) return
            const handlers = this.listeners.get(channel)
            if (handlers) {
              const args = frame.params !== undefined
                ? eventParamsToArgs(channel, frame.params)
                : frame.args || []
              for (const handler of handlers) {
                try {
                  handler(...args)
                } catch (e) {
                  console.warn(`[WS] Event handler error for ${frame.channel}:`, e)
                }
              }
            }
          }
        },

        onClose: (code: number, reason: string) => {
          if (gen !== this.generation) return
          const closeTag = authResolved && this._status === 'connected' ? 'WS' : '!WS'
          dlog(closeTag, `socket closed: code=${code} reason=${reason}`, { status: this._status, authResolved })
          clearTimeout(authTimeout)
          const wasConnected = this._status === 'connected'
          this.stopHeartbeat()

          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer)
            pending.reject(new Error('Connection closed'))
          }
          this.pending.clear()
          this.rejectPendingPings(new Error('Connection closed'))

          if (this.shouldReconnect && wasConnected) {
            this.setStatus('reconnecting')
            this.scheduleReconnect(gen)
          } else if (!authResolved) {
            authResolved = true
            this.setStatus('error', 'Connection closed before auth')
            resolve(false)
          } else {
            this.setStatus('disconnected')
          }
        },

        onError: (message: string) => {
          if (gen !== this.generation) return
          dlog('!WS', `socket error: ${message}`)

          if (message.includes('TLS fingerprint mismatch')) {
            clearTimeout(authTimeout)
            if (!authResolved) {
              authResolved = true
              this.shouldReconnect = false
              this.setStatus('error', message)
              resolve(false)
            }
            return
          }

          if (!authResolved) {
            clearTimeout(authTimeout)
            authResolved = true
            this.setStatus('error', message || 'Connection failed')
            resolve(false)
          }
        },
      })
    })
  }

  // ============================================
  //   Reconnection (exponential backoff + jitter)
  // ============================================

  private scheduleReconnect(gen: number) {
    if (this.reconnectTimer) return
    if (gen !== this.generation) return

    this.reconnectAttempt++
    const base = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1), RECONNECT_MAX_MS)
    const jitter = base * (0.75 + Math.random() * 0.5)
    const delay = Math.round(jitter)

    dlog('WS', `reconnect #${this.reconnectAttempt} in ${delay}ms`)

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (!this.shouldReconnect || gen !== this.generation) return
      try {
        const ok = await this.doConnect()
        if (!ok && this.shouldReconnect && gen === this.generation) {
          this.scheduleReconnect(gen)
        }
      } catch {
        if (this.shouldReconnect && gen === this.generation) {
          this.scheduleReconnect(gen)
        }
      }
    }, delay)
  }

  // ============================================
  //   Heartbeat
  // ============================================

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        const frame: RemoteFrame = { type: 'ping', id: this.nextId() }
        this.sendFrame(frame)
      }
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  checkConnection(timeoutMs = 3_000): Promise<boolean> {
    if (!this.isConnected) {
      return Promise.resolve(false)
    }

    const id = this.nextId()
    const frame: RemoteFrame = { type: 'ping', id }
    dlog('WS', `health check ping id=${id}`)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPings.delete(id)
        dlog('!WS', `health check timeout id=${id}`)
        if (this.ws && this._status === 'connected') {
          this.ws.close(4000, 'health check timeout')
        }
        resolve(false)
      }, timeoutMs)

      this.pendingPings.set(id, {
        resolve: () => {
          dlog('WS', `health check pong id=${id}`)
          resolve(true)
        },
        reject: (error: Error) => {
          dlog('!WS', `health check failed id=${id}: ${error.message}`)
          resolve(false)
        },
        timer,
      })

      this.sendFrame(frame)
    })
  }

  // ============================================
  //   Invoke (Request-Response)
  // ============================================

  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.isConnected) {
      return Promise.reject(new Error('Not connected to remote server'))
    }

    const frameChannel = this.protocol === REMOTE_PROTOCOL_V2
      ? canonicalRemoteChannel(channel)
      : legacyRemoteChannel(channel)
    const frame: RemoteFrame = { type: 'invoke', id: this.nextId(), channel: frameChannel, args }
    dlog('WS_INVOKE', `send ${frame.channel} id=${frame.id} args=${args.length}`)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id)
        dlog('!WS_INVOKE', `timeout ${frame.channel} id=${frame.id}`)
        reject(new Error(`Remote invoke timeout: ${channel}`))
      }, INVOKE_TIMEOUT_MS)

      this.pending.set(frame.id, {
        resolve: (result: unknown) => {
          dlog('WS_INVOKE', `result ${frame.channel} id=${frame.id} ${summarizeRemoteValue(result)}`)
          resolve(result as T)
        },
        reject: (error: Error) => {
          dlog('!WS_INVOKE', `error ${frame.channel} id=${frame.id}: ${error.message}`)
          reject(error)
        },
        timer,
      })

      this.sendFrame(frame)
    })
  }

  invokeParams<T = unknown>(
    channel: string,
    params: unknown,
    legacyArgs: unknown[] = [],
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    if (!this.isConnected) {
      return Promise.reject(new Error('Not connected to remote server'))
    }

    const timeoutMs = opts?.timeoutMs ?? INVOKE_TIMEOUT_MS

    const makeFrame = (frameChannel: string): RemoteFrame => this.protocol === REMOTE_PROTOCOL_V2
      ? {
        type: 'invoke',
        id: this.nextId(),
        channel: frameChannel,
        params,
        args: legacyArgs,
      }
      : {
        type: 'invoke',
        id: this.nextId(),
        channel: frameChannel,
        args: legacyArgs,
      }
    const initialChannel = this.protocol === REMOTE_PROTOCOL_V2
      ? canonicalRemoteChannel(channel)
      : legacyRemoteChannel(channel)
    const sendFrame = (frame: RemoteFrame, allowAgentFallback: boolean): Promise<T> => {
      dlog('WS_INVOKE', `send ${frame.channel} id=${frame.id} protocol=${this.protocol} params=${summarizeRemoteValue(params)}`)

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(frame.id)
          dlog('!WS_INVOKE', `timeout ${frame.channel} id=${frame.id}`)
          reject(new Error(`Remote invoke timeout: ${channel}`))
        }, timeoutMs)

        this.pending.set(frame.id, {
          resolve: (result: unknown) => {
            dlog('WS_INVOKE', `result ${frame.channel} id=${frame.id} ${summarizeRemoteValue(result)}`)
            resolve(result as T)
          },
          reject: (error: Error) => {
            dlog('!WS_INVOKE', `error ${frame.channel} id=${frame.id}: ${error.message}`)
            if (allowAgentFallback && frame.channel?.startsWith('agent:') && isRemoteMethodNotFound(error)) {
              const fallbackChannel = legacyRemoteChannel(frame.channel)
              dlog('WS_INVOKE', `fallback ${frame.channel} -> ${fallbackChannel}`)
              sendFrame(makeFrame(fallbackChannel), false).then(resolve, reject)
              return
            }
            reject(error)
          },
          timer,
        })

        this.sendFrame(frame)
      })
    }

    return sendFrame(makeFrame(initialChannel), this.protocol === REMOTE_PROTOCOL_V2)
  }

  // ============================================
  //   Event Subscription
  // ============================================

  on(channel: string, handler: EventHandler): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    this.listeners.get(channel)!.add(handler)

    return () => {
      const handlers = this.listeners.get(channel)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          this.listeners.delete(channel)
        }
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }

  // ============================================
  //   ID Generator
  // ============================================

  private nextId(): string {
    return `${Date.now()}-${++this._counter}`
  }

  private rejectPendingPings(error: Error) {
    for (const [, pending] of this.pendingPings) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingPings.clear()
  }

  private sendFrame(frame: RemoteFrame): void {
    const payload = JSON.stringify(frame)
    if (this.compression === REMOTE_COMPRESSION_GZIP) {
      this.ws!.sendGzip(payload)
    } else {
      this.ws!.send(payload)
    }
  }
}
