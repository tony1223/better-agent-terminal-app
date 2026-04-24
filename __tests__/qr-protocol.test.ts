import { parseBATQR } from '../src/api/qr-protocol'

describe('parseBATQR', () => {
  it('parses desktop JSON QR payloads', () => {
    const payload = parseBATQR(JSON.stringify({
      url: 'wss://192.168.1.10:9876',
      token: 'token-123',
      fingerprint: 'AA:BB:CC',
      mode: 'lan',
      context: { windowId: 'window-1' },
    }))

    expect(payload).toMatchObject({
      host: '192.168.1.10',
      port: 9876,
      token: 'token-123',
      fingerprint: 'AA:BB:CC',
      mode: 'lan',
      useTLS: true,
      context: { windowId: 'window-1' },
    })
  })

  it('parses connection URL QR payloads', () => {
    const payload = parseBATQR('wss://192.168.1.10:9876?token=token-123&fp=AA%3ABB%3ACC&mode=lan&windowId=window-1')

    expect(payload).toMatchObject({
      host: '192.168.1.10',
      port: 9876,
      token: 'token-123',
      fingerprint: 'AA:BB:CC',
      mode: 'lan',
      useTLS: true,
      context: { windowId: 'window-1' },
    })
  })

  it('accepts URL payloads without a fingerprint', () => {
    const payload = parseBATQR('wss://192.168.1.10:9876?token=token-123&mode=lan')

    expect(payload).toMatchObject({
      host: '192.168.1.10',
      port: 9876,
      token: 'token-123',
      fingerprint: null,
      mode: 'lan',
      useTLS: true,
    })
  })

  it('parses wrapped connection payloads', () => {
    const payload = parseBATQR(JSON.stringify({
      connection: {
        host: '192.168.1.10',
        port: '9876',
        remoteToken: 'token-123',
        remoteFingerprint: 'AA:BB:CC',
      },
    }))

    expect(payload).toMatchObject({
      host: '192.168.1.10',
      port: 9876,
      token: 'token-123',
      fingerprint: 'AA:BB:CC',
    })
  })

  it('parses custom scheme connection payloads', () => {
    const payload = parseBATQR('bat://connect?host=192.168.1.10&port=9876&token=token-123&fingerprint=AA%3ABB%3ACC')

    expect(payload).toMatchObject({
      host: '192.168.1.10',
      port: 9876,
      token: 'token-123',
      fingerprint: 'AA:BB:CC',
    })
  })
})
