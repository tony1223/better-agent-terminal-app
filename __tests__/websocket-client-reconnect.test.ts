/**
 * Drop/recovery behaviour of the remote client.
 *
 * All of it is timer- and callback-driven, so the socket is faked and the
 * clock is jest's: what matters is which sockets get opened, and when.
 */

interface FakeSocket {
  isOpen: boolean
  sent: string[]
  closedWith: { code: number; reason: string } | null
  close(code?: number, reason?: string): void
  /** ---- host-side helpers ---- */
  open(): void
  authOk(): void
  authFail(error: string): void
  /** A frame from the host — any frame is proof the link is alive. */
  pong(): void
  /** The peer/network dropped us: a close we never asked for. */
  serverClose(code?: number): void
  fail(message: string): void
  readonly pings: number
}

const mockSockets: FakeSocket[] = []

jest.mock('@/native/tls-websocket', () => ({
  TLSWebSocket: class {
    isOpen = false
    supportsGzip = false
    sent: string[] = []
    closedWith: { code: number; reason: string } | null = null
    cb: Record<string, ((...args: any[]) => void) | undefined> = {}

    constructor() {
      mockSockets.push(this as any)
    }

    connect(_url: string, _fingerprint: string | null, callbacks: Record<string, () => void>) {
      this.cb = callbacks
    }

    send(data: string) { this.sent.push(data) }
    sendGzip(data: string) { this.sent.push(data) }

    close(code = 1000, reason = '') {
      if (this.closedWith) return
      this.closedWith = { code, reason }
      this.isOpen = false
      this.cb.onClose?.(code, reason)
    }

    open() {
      this.isOpen = true
      this.cb.onOpen?.()
    }

    authOk() {
      this.cb.onMessage?.(JSON.stringify({ type: 'auth-result', id: 'auth', protocol: 'bat-remote-v2' }))
    }

    authFail(error: string) {
      this.cb.onMessage?.(JSON.stringify({ type: 'auth-result', id: 'auth', error }))
    }

    pong() {
      this.cb.onMessage?.(JSON.stringify({ type: 'pong', id: 'hb' }))
    }

    serverClose(code = 1006) {
      this.isOpen = false
      this.closedWith = { code, reason: 'peer closed' }
      this.cb.onClose?.(code, 'peer closed')
    }

    fail(message: string) {
      this.cb.onError?.(message)
    }

    get pings(): number {
      return this.sent.filter((frame: string) => frame.includes('"ping"')).length
    }
  },
}))

import { WebSocketClient } from '../src/api/websocket-client'

async function connectedClient(): Promise<{ client: WebSocketClient; socket: FakeSocket }> {
  const client = new WebSocketClient()
  const connecting = client.connect('host', 1234, 'token')
  const socket = mockSockets[mockSockets.length - 1]
  socket.open()
  socket.authOk()
  await expect(connecting).resolves.toBe(true)
  return { client, socket }
}

beforeEach(() => {
  mockSockets.length = 0
  jest.useFakeTimers()
  // Backoff jitter: pin it so "advance past the delay" is exact.
  jest.spyOn(Math, 'random').mockReturnValue(0.5)
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('recovering from a drop', () => {
  it('retries after the peer closes an established session', async () => {
    const { client, socket } = await connectedClient()

    socket.serverClose()
    expect(client.status).toBe('reconnecting')
    expect(client.willRetry).toBe(true)

    // First backoff is ~1s; nothing should fire before it.
    await jest.advanceTimersByTimeAsync(200)
    expect(mockSockets).toHaveLength(1)

    await jest.advanceTimersByTimeAsync(2_000)
    expect(mockSockets).toHaveLength(2)

    mockSockets[1].open()
    mockSockets[1].authOk()
    await jest.advanceTimersByTimeAsync(0)
    expect(client.status).toBe('connected')
  })

  it('keeps retrying when an attempt dies before it can authenticate', async () => {
    const { client, socket } = await connectedClient()
    socket.serverClose()

    await jest.advanceTimersByTimeAsync(2_000)
    expect(mockSockets).toHaveLength(2)

    // Socket opened, then the network went away mid-auth. This used to land
    // in 'error' and stop the loop dead.
    mockSockets[1].open()
    mockSockets[1].serverClose()
    expect(client.status).toBe('reconnecting')

    await jest.advanceTimersByTimeAsync(5_000)
    expect(mockSockets.length).toBeGreaterThanOrEqual(3)
  })

  it('gives up when the host rejects the token on the way back', async () => {
    const { client, socket } = await connectedClient()
    socket.serverClose()
    await jest.advanceTimersByTimeAsync(2_000)

    mockSockets[1].open()
    mockSockets[1].authFail('invalid token')
    expect(client.status).toBe('error')
    expect(client.error).toBe('invalid token')
    expect(client.willRetry).toBe(false)

    await jest.advanceTimersByTimeAsync(120_000)
    expect(mockSockets).toHaveLength(2)
  })

  it('reports a first connect that never got in, without retrying behind the user', async () => {
    const client = new WebSocketClient()
    const connecting = client.connect('host', 1234, 'token')
    mockSockets[0].fail('Network unreachable')

    await expect(connecting).resolves.toBe(false)
    expect(client.status).toBe('error')
    expect(client.willRetry).toBe(false)

    await jest.advanceTimersByTimeAsync(120_000)
    expect(mockSockets).toHaveLength(1)
  })
})

describe('noticing a socket that died quietly', () => {
  it('closes and reconnects when nothing comes back', async () => {
    const { client, socket } = await connectedClient()

    // Pings go out, nothing answers — the half-open socket a phone gets when
    // it changes network. isOpen still says true the whole time.
    await jest.advanceTimersByTimeAsync(30_000)

    expect(socket.pings).toBeGreaterThan(0)
    expect(socket.closedWith?.code).toBe(4000)
    expect(client.status).toBe('reconnecting')

    await jest.advanceTimersByTimeAsync(2_000)
    expect(mockSockets).toHaveLength(2)
  })

  it('stays put while the host keeps answering', async () => {
    const { client, socket } = await connectedClient()

    for (let i = 0; i < 6; i++) {
      await jest.advanceTimersByTimeAsync(10_000)
      socket.pong()
    }

    expect(socket.closedWith).toBeNull()
    expect(client.status).toBe('connected')
  })

  it('treats a socket that closed without telling us as a drop', async () => {
    const { client, socket } = await connectedClient()

    // No onClose delivered — the object just stops being open.
    socket.isOpen = false
    await jest.advanceTimersByTimeAsync(10_000)

    expect(client.status).toBe('reconnecting')
    await jest.advanceTimersByTimeAsync(2_000)
    expect(mockSockets).toHaveLength(2)
  })
})

describe('foreground resume', () => {
  it('retries immediately instead of waiting out the backoff', async () => {
    const { client, socket } = await connectedClient()
    socket.serverClose()

    await jest.advanceTimersByTimeAsync(2_000)
    expect(mockSockets).toHaveLength(2)

    // That attempt failed too, so the next backoff is longer — the delay the
    // app would otherwise sit out after coming back from the background.
    mockSockets[1].fail('Network unreachable')
    await jest.advanceTimersByTimeAsync(0)

    client.resume()
    expect(mockSockets).toHaveLength(3)

    mockSockets[2].open()
    mockSockets[2].authOk()
    await jest.advanceTimersByTimeAsync(0)
    expect(client.status).toBe('connected')
  })

  it('does nothing for a client the user disconnected', async () => {
    const { client, socket } = await connectedClient()
    client.disconnect()
    expect(socket.closedWith).not.toBeNull()

    client.resume()
    await jest.advanceTimersByTimeAsync(60_000)
    expect(mockSockets).toHaveLength(1)
  })
})
