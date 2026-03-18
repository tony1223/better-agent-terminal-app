/**
 * WebSocket Client for BAT Remote Protocol
 * Reference: BAT Desktop electron/remote/remote-client.ts
 *
 * Uses RN built-in WebSocket (global).
 * Implements auth, request-response correlation, event dispatch, and auto-reconnect.
 */

import { PROXIED_EVENTS, type RemoteFrame } from './protocol'
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

export class WebSocketClient {
  private ws: WebSocket | null = null
  private pending: Map<string, PendingInvoke> = new Map()
  private listeners: Map<string, Set<EventHandler>> = new Map()
  private statusListeners: Set<StatusListener> = new Set()
  private _status: ConnectionStatus = 'disconnected'
  private _counter = 0
  private _error: string | null = null

  // Reconnection state
  private host = ''
  private port = 0
  private token = ''
  private label = ''
  private shouldReconnect = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  get status(): ConnectionStatus {
    return this._status
  }

  get error(): string | null {
    return this._error
  }

  get isConnected(): boolean {
    return this._status === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  get connectionInfo(): { host: string; port: number } | null {
    if (!this.isConnected) return null
    return { host: this.host, port: this.port }
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

  connect(host: string, port: number, token: string, label?: string): Promise<boolean> {
    if (this.ws) this.disconnect()

    this.host = host
    this.port = port
    this.token = token
    this.label = label || `BAT-Mobile-${Date.now()}`
    this.shouldReconnect = true

    return this.doConnect()
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Reject all pending
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Disconnected'))
      this.pending.delete(id)
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.setStatus('disconnected')
  }

  // ============================================
  //   Internal Connect
  // ============================================

  private doConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.setStatus('connecting')

      const url = `ws://${this.host}:${this.port}`
      dlog('WS', `connecting to ${url}`)
      this.ws = new WebSocket(url)

      let authResolved = false

      const authTimeout = setTimeout(() => {
        if (!authResolved) {
          authResolved = true
          this.setStatus('error', 'Authentication timeout')
          this.ws?.close()
          resolve(false)
        }
      }, 10000)

      this.ws.onopen = () => {
        dlog('WS', 'socket opened, sending auth...')
        this.setStatus('authenticating')
        const authFrame: RemoteFrame = {
          type: 'auth',
          id: this.nextId(),
          token: this.token,
          args: [this.label],
        }
        this.ws!.send(JSON.stringify(authFrame))
      }

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        let frame: RemoteFrame
        try {
          frame = JSON.parse(typeof event.data === 'string' ? event.data : '')
        } catch {
          return
        }

        // Auth result
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
              this.startHeartbeat()
              resolve(true)
            }
          }
          return
        }

        // Invoke result
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

        // Pong (heartbeat response)
        if (frame.type === 'pong') return

        // Event → dispatch to listeners
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
          return
        }
      }

      this.ws.onclose = () => {
        dlog('WS', `socket closed (was: ${this._status})`)
        clearTimeout(authTimeout)
        const wasConnected = this._status === 'connected'
        this.stopHeartbeat()

        // Reject all pending invokes
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error('Connection closed'))
          this.pending.delete(id)
        }

        if (this.shouldReconnect && wasConnected) {
          this.setStatus('reconnecting')
          this.scheduleReconnect()
        } else if (!authResolved) {
          authResolved = true
          this.setStatus('error', 'Connection closed before auth')
          resolve(false)
        } else {
          this.setStatus('disconnected')
        }
      }

      this.ws.onerror = (event: Event) => {
        dlog('WS', `socket error: ${JSON.stringify(event)}`)
        if (!authResolved) {
          clearTimeout(authTimeout)
          authResolved = true
          this.setStatus('error', 'Connection failed')
          resolve(false)
        }
      }
    })
  }

  // ============================================
  //   Reconnection
  // ============================================

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (!this.shouldReconnect) return
      try {
        const ok = await this.doConnect()
        if (!ok && this.shouldReconnect) {
          this.scheduleReconnect()
        }
      } catch {
        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }
    }, 3000)
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
    }, 15000)
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
      }, 30000)

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

  /** Remove all event listeners */
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

// Singleton instance
export const wsClient = new WebSocketClient()
