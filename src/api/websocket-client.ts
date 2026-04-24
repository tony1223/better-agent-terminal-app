/**
 * WebSocket Client for BAT Remote Protocol
 * Reference: BAT Desktop electron/remote/remote-client.ts
 *
 * Supports wss:// with SHA-256 certificate fingerprint pinning via native TLS module.
 * Falls back to plain ws:// when no fingerprint is provided.
 * Implements auth, request-response correlation, event dispatch, and exponential backoff reconnect.
 */

import { PROXIED_EVENTS, type RemoteFrame } from './protocol'
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

type EventHandler = (...args: unknown[]) => void
type StatusListener = (status: ConnectionStatus) => void

export interface RemoteClientContext {
  windowId?: string | null
}

const AUTH_TIMEOUT_MS = 10_000
const INVOKE_TIMEOUT_MS = 30_000
const HEARTBEAT_MS = 30_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export class WebSocketClient {
  private ws: TLSWebSocket | null = null
  private pending: Map<string, PendingInvoke> = new Map()
  private listeners: Map<string, Set<EventHandler>> = new Map()
  private statusListeners: Set<StatusListener> = new Set()
  private _status: ConnectionStatus = 'disconnected'
  private _counter = 0
  private _error: string | null = null

  // Connection params
  private host = ''
  private port = 0
  private token = ''
  private fingerprint: string | null = null
  private label = ''
  private context: RemoteClientContext | null = null
  private shouldReconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private generation = 0

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

  get connectionInfo(): { host: string; port: number; tls: boolean } | null {
    if (!this.isConnected) return null
    return { host: this.host, port: this.port, tls: !!this.fingerprint }
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
  ): Promise<boolean> {
    if (this.ws) this.disconnect()

    this.host = host
    this.port = port
    this.token = token
    this.fingerprint = fingerprint ?? null
    this.label = label || `BAT-Mobile-${Date.now()}`
    this.context = context ?? null
    this.shouldReconnect = true
    this.reconnectAttempt = 0
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

      const scheme = this.fingerprint ? 'wss' : 'ws'
      const url = `${scheme}://${this.host}:${this.port}`
      dlog('WS', `connecting to ${url} (TLS=${!!this.fingerprint})`)

      const ws = new TLSWebSocket()
      this.ws = ws

      let authResolved = false

      const authTimeout = setTimeout(() => {
        if (!authResolved && gen === this.generation) {
          authResolved = true
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
            args: [this.label, this.context],
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
                dlog('WS', `auth failed: ${frame.error}`)
                this.setStatus('error', frame.error)
                resolve(false)
              } else {
                dlog('WS', 'auth success, connected!')
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

          if (frame.type === 'pong') return

          if (frame.type === 'event' && frame.channel && PROXIED_EVENTS.has(frame.channel)) {
            const handlers = this.listeners.get(frame.channel)
            if (handlers) {
              const args = frame.args || []
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

        onClose: (_code: number, _reason: string) => {
          if (gen !== this.generation) return
          dlog('WS', `socket closed (was: ${this._status})`)
          clearTimeout(authTimeout)
          const wasConnected = this._status === 'connected'
          this.stopHeartbeat()

          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer)
            pending.reject(new Error('Connection closed'))
          }
          this.pending.clear()

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
          dlog('WS', `socket error: ${message}`)

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
        this.ws!.send(JSON.stringify(frame))
      }
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ============================================
  //   Invoke (Request-Response)
  // ============================================

  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.isConnected) {
      return Promise.reject(new Error('Not connected to remote server'))
    }

    const id = this.nextId()
    const frame: RemoteFrame = { type: 'invoke', id, channel, args }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Remote invoke timeout: ${channel}`))
      }, INVOKE_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      })

      this.ws!.send(JSON.stringify(frame))
    })
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
}
