import { NativeModules, NativeEventEmitter, Platform } from 'react-native'
import { dlog } from '@/utils/debug-log'

const { TLSWebSocket: NativeTLS } = NativeModules

const emitter = NativeTLS ? new NativeEventEmitter(NativeTLS) : null

export type TLSSocketState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'

export interface TLSWebSocketCallbacks {
  onOpen?: () => void
  onMessage?: (data: string) => void
  onClose?: (code: number, reason: string) => void
  onError?: (message: string) => void
}

export class TLSWebSocket {
  private subs: Array<{ remove: () => void }> = []
  private _readyState: TLSSocketState = 'CLOSED'
  private callbacks: TLSWebSocketCallbacks = {}

  get readyState(): TLSSocketState {
    return this._readyState
  }

  get isOpen(): boolean {
    return this._readyState === 'OPEN'
  }

  connect(url: string, fingerprint: string | null, callbacks: TLSWebSocketCallbacks): void {
    this.cleanup()
    this.callbacks = callbacks

    if (!NativeTLS || !emitter) {
      dlog('TLS', 'native module unavailable, falling back to plain WebSocket')
      this.connectFallback(url, callbacks)
      return
    }

    this._readyState = 'CONNECTING'

    this.subs.push(
      emitter.addListener('TLSWebSocket_onOpen', () => {
        dlog('TLS', 'connected (native TLS)')
        this._readyState = 'OPEN'
        callbacks.onOpen?.()
      }),
      emitter.addListener('TLSWebSocket_onMessage', (event: { data: string }) => {
        callbacks.onMessage?.(event.data)
      }),
      emitter.addListener('TLSWebSocket_onClose', (event: { code: number; reason: string }) => {
        dlog('TLS', `closed: code=${event.code} reason=${event.reason}`)
        this._readyState = 'CLOSED'
        callbacks.onClose?.(event.code, event.reason)
      }),
      emitter.addListener('TLSWebSocket_onError', (event: { message: string }) => {
        dlog('TLS', `error: ${event.message}`)
        callbacks.onError?.(event.message)
      }),
    )

    NativeTLS.connect(url, fingerprint || null)
  }

  send(data: string): void {
    if (!NativeTLS) return
    if (this._readyState !== 'OPEN') return
    NativeTLS.send(data)
  }

  close(code = 1000, reason?: string): void {
    if (!NativeTLS) return
    this._readyState = 'CLOSING'
    NativeTLS.close(code, reason || null)
    this.cleanup()
  }

  private cleanup(): void {
    for (const sub of this.subs) sub.remove()
    this.subs = []
    this.callbacks = {}
  }

  private connectFallback(url: string, callbacks: TLSWebSocketCallbacks): void {
    this._readyState = 'CONNECTING'
    const ws = new WebSocket(url)
    const self = this

    ws.onopen = () => {
      self._readyState = 'OPEN'
      callbacks.onOpen?.()
    }
    ws.onmessage = (event) => {
      callbacks.onMessage?.(typeof event.data === 'string' ? event.data : '')
    }
    ws.onclose = (event) => {
      self._readyState = 'CLOSED'
      callbacks.onClose?.(event.code ?? 1000, event.reason ?? '')
    }
    ws.onerror = () => {
      callbacks.onError?.('WebSocket connection failed')
    }

    const origSend = this.send.bind(this)
    this.send = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    }
    const origClose = this.close.bind(this)
    this.close = (code = 1000, reason?: string) => {
      self._readyState = 'CLOSING'
      ws.close(code, reason)
    }
  }
}
