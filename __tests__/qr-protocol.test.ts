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
})
