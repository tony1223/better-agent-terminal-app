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

  it('parses the current desktop QR payload shape', () => {
    const payload = parseBATQR('{"url":"wss://192.168.1.200:9876","token":"16429b0bea39161c72b4601913f1c3ef","fingerprint":"30:A4:5B:A7:85:00:89:CA:D8:28:BC:97:94:F0:86:E5:AB:BF:CE:28:3D:7F:66:FE:64:BB:CA:17:AC:5C:B1:01","mode":"lan","context":{"windowId":"win-1777043831341-lx4oii"}}')

    expect(payload).toMatchObject({
      host: '192.168.1.200',
      port: 9876,
      token: '16429b0bea39161c72b4601913f1c3ef',
      fingerprint: '30:A4:5B:A7:85:00:89:CA:D8:28:BC:97:94:F0:86:E5:AB:BF:CE:28:3D:7F:66:FE:64:BB:CA:17:AC:5C:B1:01',
      mode: 'lan',
      useTLS: true,
      context: { windowId: 'win-1777043831341-lx4oii' },
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
