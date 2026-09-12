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
  /** The client's own callbacks, for feeding it a reply to a specific frame. */
  cb: Record<string, ((...args: any[]) => void) | undefined>
}

const mockSockets: FakeSocket[] = []

// jest.mock factories can't close over imports, and only `mock*` names are let
// through — so the constant is required lazily inside the factory instead.
const mockProtocolV2 = () => require('../src/api/protocol').REMOTE_PROTOCOL_V2

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
      // The real string, from the real constant. A near-miss ('bat-remote-v2')
      // silently negotiates the v1 fallback, where invokeParams drops `params`
      // entirely — so every test would exercise a protocol the app never speaks.
      this.cb.onMessage?.(JSON.stringify({ type: 'auth-result', id: 'auth', protocol: mockProtocolV2() }))
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
  it('routes requests and events through immutable profile contexts', async () => {
    const { client, socket } = await connectedClient()
    const a = client.scoped('context-a')
    const b = client.scoped('context-b')
    const onA = jest.fn()
    const onB = jest.fn()
    const onRoot = jest.fn()
    a.on('agent:message', onA)
    b.on('agent:message', onB)
    client.on('agent:message', onRoot)
    const request = a.invokeParams('agent:send-message', { sessionId: 'same-id', prompt: 'hello' })
    const frame = JSON.parse(socket.sent.at(-1)!)
    expect(frame.contextId).toBe('context-a')
    socket.cb.onMessage?.(JSON.stringify({ type: 'invoke-result', id: frame.id, result: { ok: true } }))
    await expect(request).resolves.toEqual({ ok: true })
    socket.cb.onMessage?.(JSON.stringify({ type: 'event', channel: 'agent:message', contextId: 'context-b',
      params: { sessionId: 'same-id', message: { content: 'remote hello' } } }))
    expect(onA).not.toHaveBeenCalled()
    expect(onRoot).not.toHaveBeenCalled()
    expect(onB).toHaveBeenCalledWith('same-id', { content: 'remote hello' })
    client.disconnect()
  })

  it('keeps positional file requests scoped and refuses an expired connection', async () => {
    const { client, socket } = await connectedClient()
    const scoped = client.scoped('context-a')
    const request = scoped.invoke('fs:readFile', '/project/readme.md')
    const frame = JSON.parse(socket.sent.at(-1)!)
    expect(frame).toMatchObject({ contextId: 'context-a', args: ['/project/readme.md'] })
    socket.cb.onMessage?.(JSON.stringify({ type: 'invoke-result', id: frame.id, result: 'hello' }))
    await expect(request).resolves.toBe('hello')
    client.disconnect()
    await expect(scoped.invoke('fs:readFile', '/other')).rejects.toThrow('Profile connection changed')
  })

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

describe('sending something large', () => {
  // A phone screenshot rides inline in agent:send-message as base64. It sits in
  // the uplink for tens of seconds, and every ping we queue behind it waits its
  // turn — so the host has nothing to answer and no frame comes back. The
  // liveness check used to read that as a dead link and close the socket in the
  // middle of our own upload, which is what "images are slow and often fail"
  // actually was.
  const bigParams = { prompt: 'look', images: ['x'.repeat(2_000_000)] }

  it('does not sever the connection while a big frame is still going out', async () => {
    const { client, socket } = await connectedClient()

    client.invokeParams('agent:send-message', bigParams).catch(() => undefined)

    // Well past the 25s liveness window, with nothing coming back.
    await jest.advanceTimersByTimeAsync(40_000)

    expect(socket.closedWith).toBeNull()
    expect(client.status).toBe('connected')
  })

  it('still gives the send a deadline rather than waiting forever', async () => {
    const { client } = await connectedClient()

    const send = client.invokeParams('agent:send-message', bigParams)
    const settled = jest.fn()
    send.then(settled, settled)

    await jest.advanceTimersByTimeAsync(60_000)
    expect(settled).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(10 * 60_000)
    expect(settled).toHaveBeenCalled()
    await expect(send).rejects.toThrow(/timeout/i)
  })

  it('goes back to watching the link once the upload is acked', async () => {
    const { client, socket } = await connectedClient()

    const send = client.invokeParams('agent:send-message', bigParams)
    await jest.advanceTimersByTimeAsync(1_000)

    const sent = JSON.parse(socket.sent[socket.sent.length - 1])
    socket.cb.onMessage?.(JSON.stringify({ type: 'invoke-result', id: sent.id, result: { ok: true } }))
    await expect(send).resolves.toEqual({ ok: true })

    // The grace period outlives the upload it was granted for, by design — but
    // it must expire, and a link that then goes quiet has to be caught.
    await jest.advanceTimersByTimeAsync(3 * 60_000)
    expect(socket.closedWith?.code).toBe(4000)
    expect(client.status).toBe('reconnecting')
  })

  it('puts the payload on the wire once, not twice', async () => {
    const { client, socket } = await connectedClient()

    client.invokeParams('agent:send-message', bigParams).catch(() => undefined)

    const raw = socket.sent[socket.sent.length - 1]
    const frame = JSON.parse(raw)
    // The host reads `args` only when `params` is absent, so a v2 frame
    // carrying both ships a second copy for it to throw away. DEFLATE can't
    // save us either — the copies sit megabytes apart, far outside its 32 KB
    // window — so the duplicate is paid for in full on the uplink.
    expect(frame.params).toBeDefined()
    expect(frame.args).toBeUndefined()
    expect(raw.length).toBeLessThan(bigParams.images[0].length * 1.1)
  })

  it('a small frame gets no grace at all', async () => {
    const { client, socket } = await connectedClient()

    client.invokeParams('agent:get-session-state', { sessionId: 's1' }).catch(() => undefined)
    await jest.advanceTimersByTimeAsync(30_000)

    expect(socket.closedWith?.code).toBe(4000)
    expect(client.status).toBe('reconnecting')
  })
})

describe('health probe', () => {
  // The generic pong() helper answers a fixed id; a probe is matched by the id
  // it actually went out with.
  function answerLastPing(socket: FakeSocket) {
    const last = JSON.parse(socket.sent[socket.sent.length - 1])
    socket.cb.onMessage?.(JSON.stringify({ type: 'pong', id: last.id }))
  }

  it('does not tear down the link over a single missed probe', async () => {
    const { client, socket } = await connectedClient()

    const probe = client.checkConnection()
    await jest.advanceTimersByTimeAsync(11_000)

    await expect(probe).resolves.toBe(false)
    // A phone on congested LTE misses one and is still perfectly usable;
    // reconnecting costs every in-flight request.
    expect(socket.closedWith).toBeNull()
    expect(client.status).toBe('connected')
  })

  it('gives up once two in a row go unanswered', async () => {
    const { client, socket } = await connectedClient()

    const first = client.checkConnection()
    await jest.advanceTimersByTimeAsync(11_000)
    await expect(first).resolves.toBe(false)

    const second = client.checkConnection()
    await jest.advanceTimersByTimeAsync(11_000)
    await expect(second).resolves.toBe(false)

    expect(socket.closedWith?.code).toBe(4000)
    // Two probes' worth of fake time is well past the first backoff, so the
    // recovery has already started — what matters is that it started.
    expect(client.status).not.toBe('connected')
    expect(mockSockets).toHaveLength(2)
  })

  it('a probe that comes back clears the tally', async () => {
    const { client, socket } = await connectedClient()

    const missed = client.checkConnection()
    await jest.advanceTimersByTimeAsync(11_000)
    await expect(missed).resolves.toBe(false)

    const answered = client.checkConnection()
    answerLastPing(socket)
    await expect(answered).resolves.toBe(true)

    // Without the reset this next miss would be the second strike.
    const again = client.checkConnection()
    await jest.advanceTimersByTimeAsync(11_000)
    await expect(again).resolves.toBe(false)

    expect(socket.closedWith).toBeNull()
    expect(client.status).toBe('connected')
  })

  it('does not hold a probe against a link busy with our own upload', async () => {
    const { client, socket } = await connectedClient()

    client.invokeParams('agent:send-message', { prompt: 'look', images: ['x'.repeat(2_000_000)] })
      .catch(() => undefined)

    // Two misses, which would normally be a verdict — but the probes are
    // queued behind our upload, so the host was never asked anything.
    for (let i = 0; i < 2; i++) {
      const probe = client.checkConnection()
      await jest.advanceTimersByTimeAsync(11_000)
      await expect(probe).resolves.toBe(false)
    }

    expect(socket.closedWith).toBeNull()
    expect(client.status).toBe('connected')
  })
})

describe('foreground resume', () => {
  it.each([25_000, 5 * 60_000])('reconnects immediately after %i ms without an inbound frame', async (elapsed) => {
    const { client, socket } = await connectedClient()
    const statuses: string[] = []
    client.onStatusChange(status => statuses.push(status))
    // Changing wall time without running timers models background suspension.
    jest.setSystemTime(Date.now() + elapsed)

    client.resume()

    expect(socket.closedWith).toEqual({ code: 4000, reason: 'foreground reconnect' })
    expect(socket.pings).toBe(0)
    expect(mockSockets).toHaveLength(2)
    expect(statuses).toEqual(['reconnecting', 'connecting'])
    expect(client.willRetry).toBe(true)
    // Repeated active notifications must not start parallel handshakes.
    client.resume()
    expect(mockSockets).toHaveLength(2)
    mockSockets[1].open()
    expect(JSON.parse(mockSockets[1].sent[0])).toMatchObject({ type: 'auth', token: 'token' })
    mockSockets[1].authOk()
    await jest.advanceTimersByTimeAsync(0)
    expect(client.status).toBe('connected')
    client.disconnect()
  })

  it('does not need a native close callback and ignores late callbacks from the old socket', async () => {
    const { client, socket } = await connectedClient()
    const close = jest.spyOn(socket, 'close').mockImplementation(() => { socket.isOpen = false })
    const scoped = client.scoped('old-context')
    const request = scoped.invoke('fs:readFile', '/project/readme.md')
    const rejected = request.catch(error => error)
    const probe = client.checkConnection()
    jest.setSystemTime(Date.now() + 60_000)

    client.resume()

    expect(close).toHaveBeenCalledWith(4000, 'foreground reconnect')
    expect(mockSockets).toHaveLength(2)
    await expect(rejected).resolves.toEqual(new Error('Connection stale after foreground resume'))
    await expect(probe).resolves.toBe(false)
    mockSockets[1].open()
    mockSockets[1].authOk()
    await jest.advanceTimersByTimeAsync(0)
    socket.serverClose()
    socket.fail('late network error')
    socket.open()
    socket.authFail('late auth failure')
    expect(client.status).toBe('connected')
    expect(client.willRetry).toBe(true)
    await expect(scoped.invoke('fs:readFile', '/project/readme.md')).rejects.toThrow('Profile connection changed')
    // A delayed old pong must not make the new connection look fresh.
    jest.setSystemTime(Date.now() + 25_000)
    socket.pong()
    client.resume()
    expect(mockSockets).toHaveLength(3)
    mockSockets[2].open()
    mockSockets[2].authOk()
    await jest.advanceTimersByTimeAsync(0)
    client.disconnect()
  })

  it('probes a fresh connection instead of disrupting it', async () => {
    const { client, socket } = await connectedClient()
    jest.setSystemTime(Date.now() + 24_999)
    client.resume()
    expect(mockSockets).toHaveLength(1)
    expect(socket.closedWith).toBeNull()
    expect(socket.pings).toBe(1)
    const ping = JSON.parse(socket.sent.at(-1)!)
    socket.cb.onMessage?.(JSON.stringify({ type: 'pong', id: ping.id }))
    await jest.advanceTimersByTimeAsync(0)
    expect(client.status).toBe('connected')
    client.disconnect()
  })

  it('uses the last received frame, not the age of the connection', async () => {
    const { client, socket } = await connectedClient()
    jest.setSystemTime(Date.now() + 5 * 60_000)
    socket.pong()
    client.resume()
    expect(mockSockets).toHaveLength(1)
    expect(socket.pings).toBe(1)
    expect(socket.closedWith).toBeNull()
    client.disconnect()
  })

  it('reconnects a closed socket even when its last frame is fresh', async () => {
    const { client, socket } = await connectedClient()
    socket.isOpen = false
    client.resume()
    expect(mockSockets).toHaveLength(2)
    expect(client.status).toBe('connecting')
    mockSockets[1].open()
    mockSockets[1].authOk()
    await jest.advanceTimersByTimeAsync(0)
    client.disconnect()
  })

  it('discards stale upload grace and does not resend interrupted requests', async () => {
    const { client, socket } = await connectedClient()
    const upload = client.invokeParams('agent:send-message', { prompt: 'look', images: ['x'.repeat(2_000_000)] })
    const rejected = upload.catch(error => error)
    jest.setSystemTime(Date.now() + 25_000)
    client.resume()
    await expect(rejected).resolves.toEqual(new Error('Connection stale after foreground resume'))
    expect(socket.closedWith?.code).toBe(4000)
    expect(mockSockets).toHaveLength(2)
    const replacement = mockSockets[1]
    replacement.open()
    replacement.authOk()
    await jest.advanceTimersByTimeAsync(0)
    expect(replacement.sent.map(raw => JSON.parse(raw).type)).toEqual(['auth'])
    // Grace granted to the old upload must not mask a dead replacement.
    await jest.advanceTimersByTimeAsync(30_000)
    expect(replacement.closedWith?.code).toBe(4000)
    client.disconnect()
  })

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
